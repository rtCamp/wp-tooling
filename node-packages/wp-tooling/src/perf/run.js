/**
 * perf -- run lab Core Web Vitals + Lighthouse (+ optional server-side
 * xhprof over WP-CLI) and emit a normalized two-layer performance report.
 *
 * Library API:
 *   const { runPerf } = require( '@rtcamp/wp-tooling/perf' );
 *
 * CLI:
 *   wp-tooling perf [options]
 *
 * URLs and layer settings come from the project's perf config
 * (`.perfrc.json`, or an explicit `--config` path), or from repeatable
 * `--url` values when there is no config — the config is optional, unlike
 * a11y's. Zero runtime dependencies: Node built-ins plus the
 * project-installed `puppeteer`, `web-vitals`, and `lighthouse` dev
 * dependencies (`wp-tooling add setup/perf` scaffolds a config and these
 * deps for projects that need one).
 */

'use strict';

const fs = require('fs');
const { RunnerError } = require('./errors');
const { resolveConfig } = require('./config');
const {
	resolveModuleFile,
	requireModule,
	detectModule,
} = require('./resolve-module');
const { detectBin } = require('./resolve-bin');
const { launchBrowser, collectVitals } = require('./collect-vitals');
const { runLighthouse, BIN: LIGHTHOUSE_BIN } = require('./lighthouse');
const { runServerProfile } = require('./server-profile');
const { normalizePerf, extractLighthouse } = require('./normalize');

const INSTALL_HINT = 'wp-tooling add setup/perf';
const WEB_VITALS_DIST = 'dist/web-vitals.attribution.iife.js';

/**
 * Throw `EBINMISSING` with the standard install hint unless `condition` holds.
 *
 * @param {*}      condition Truthy value required to proceed.
 * @param {string} message   Error message.
 * @param {Object} [details] Extra `RunnerError` details (merged with `install`).
 * @return {void}
 * @throws {RunnerError} `EBINMISSING` when `condition` is falsy.
 */
function requireInstalled(condition, message, details = {}) {
	if (!condition) {
		throw new RunnerError('EBINMISSING', message, {
			install: INSTALL_HINT,
			...details,
		});
	}
}

/**
 * Run the perf layers against the config's (or `--url`'s) URLs and return
 * the normalized report.
 *
 * @param {Object}   [options]
 * @param {string}   [options.configPath] Path to the perf config (default `.perfrc.json`).
 * @param {string[]} [options.urls]       Repeatable `--url` values.
 * @param {string}   [options.cwd]        Project root.
 * @return {Promise<Object>} Normalized report (see normalize.js).
 * @throws {RunnerError} EBINMISSING / EBINFAIL / EBADJSON / ENOURLS.
 */
async function runPerf(options = {}) {
	const cwd = options.cwd || process.cwd();
	const { config, urls } = resolveConfig({
		configPath: options.configPath,
		urls: options.urls,
		cwd,
	});

	const puppeteer = requireModule('puppeteer', { cwd });
	requireInstalled(
		puppeteer,
		`puppeteer not found. Install it in the project (\`${INSTALL_HINT}\` sets it up).`
	);

	const webVitalsFile = resolveModuleFile('web-vitals', WEB_VITALS_DIST, {
		cwd,
	});
	requireInstalled(
		webVitalsFile,
		`web-vitals attribution build not found at node_modules/web-vitals/${WEB_VITALS_DIST}. Install it in the project (\`${INSTALL_HINT}\` sets it up).`
	);
	const scriptSource = fs.readFileSync(webVitalsFile, 'utf8');

	let lighthouseBin = null;
	if (config.lighthouse.enabled) {
		lighthouseBin = detectBin(LIGHTHOUSE_BIN, { cwd });
		requireInstalled(
			lighthouseBin.available,
			`${LIGHTHOUSE_BIN} not found. Install it in the project (\`${INSTALL_HINT}\` sets it up), or set lighthouse.enabled to false.`,
			{ bin: LIGHTHOUSE_BIN }
		);
	}

	let chromePath = null;
	try {
		// `await` works whether the consumer's puppeteer version returns the
		// path synchronously or (25.x+) as a Promise.
		chromePath = await puppeteer.executablePath();
	} catch {
		chromePath = null;
	}

	const browser = await launchBrowser(puppeteer, {
		chromeArgs: config.webVitals.chromeArgs,
	});

	const rawResults = [];
	try {
		for (const url of urls) {
			rawResults.push(
				await collectOne(url, {
					browser,
					scriptSource,
					config,
					lighthouseBin,
					chromePath,
					cwd,
				})
			);
		}
	} finally {
		await browser.close();
	}

	return normalizePerf(rawResults, { thresholds: config.thresholds });
}

/**
 * Run every layer for one URL. Frontend load failure becomes a per-URL
 * `scanError` (the caller's run continues); lighthouse and server failures
 * degrade to `null` + a note without affecting the overall run.
 *
 * @param {string}      url               Target URL.
 * @param {Object}      ctx               Shared context for the run.
 * @param {Object}      ctx.browser       Puppeteer `Browser` instance.
 * @param {string}      ctx.scriptSource  web-vitals attribution IIFE source.
 * @param {Object}      ctx.config        Resolved perf config.
 * @param {Object|null} ctx.lighthouseBin Resolved lighthouse binary, or null when disabled.
 * @param {string|null} ctx.chromePath    Chrome executable path, or null.
 * @param {string}      ctx.cwd           Working directory.
 * @return {Promise<Object>} Raw per-URL capture consumed by `normalizePerf`.
 */
async function collectOne(url, ctx) {
	const { browser, scriptSource, config, lighthouseBin, chromePath, cwd } =
		ctx;
	const notes = [];
	let vitals = null;
	let scanError = null;

	try {
		vitals = await collectVitals(
			browser,
			scriptSource,
			url,
			config.webVitals
		);
	} catch (err) {
		scanError = (err && err.message ? err.message : '').toString();
	}

	let lighthouse = null;
	// Lighthouse needs the same network reachability as puppeteer -- skip it
	// once the page already failed to load, rather than spend its own timeout
	// on a dead URL.
	if (!scanError && config.lighthouse.enabled && lighthouseBin) {
		try {
			const lhr = runLighthouse(lighthouseBin, url, config.lighthouse, {
				cwd,
				chromePath,
			});
			// A raw LHR can run several MB; extract immediately so only the
			// slim shape is kept for the rest of the run.
			lighthouse = extractLighthouse(lhr, {
				topAudits: config.lighthouse.topAudits,
			});
		} catch (err) {
			const detail = (err && err.message ? err.message : '').toString();
			notes.push(`lighthouse: failed — ${detail}`);
			process.stderr.write(
				`perf: lighthouse failed for ${url}: ${detail}\n`
			);
		}
	}

	// The server layer profiles via WP-CLI, not the browser, so it runs
	// regardless of whether the page loaded.
	let server = null;
	if (config.server.enabled) {
		server = runServerProfile(config.server, url, { cwd });
		if (server.error) {
			process.stderr.write(
				`perf: server profile failed for ${url}: ${server.error}\n`
			);
		}
	}

	return { url, scanError, vitals, lighthouse, server, notes };
}

const VALID_OUTPUTS = ['text', 'json'];

/**
 * Consume the argv slot at `index` as a value for `flag`.
 *
 * @param {string[]} argv  Argument vector.
 * @param {number}   index Position of the value.
 * @param {string}   flag  Flag name, for the error message.
 * @return {string} The validated value.
 */
function takeValue(argv, index, flag) {
	const value = argv[index];
	if (value === undefined || value.startsWith('-')) {
		throw new Error(`missing value for ${flag}`);
	}
	return value;
}

/**
 * Parse argv (without leading `node` and script path).
 *
 * @param {string[]} argv Argument vector.
 * @return {Object} Parsed options.
 */
function parseArgs(argv) {
	const opts = { output: 'text', urls: [] };
	let i = 0;
	while (i < argv.length) {
		const arg = argv[i];
		switch (arg) {
			case '--config':
				opts.configPath = takeValue(argv, ++i, '--config');
				break;
			case '--url':
				opts.urls.push(takeValue(argv, ++i, '--url'));
				break;
			case '--output':
				opts.output = takeValue(argv, ++i, '--output');
				break;
			case '--dry-run':
				opts.dryRun = true;
				break;
			case '--help':
			case '-h':
				opts.help = true;
				break;
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
		i++;
	}
	return opts;
}

/**
 * Emit the normalized report in the requested output mode.
 *
 * @param {Object} report Normalized report.
 * @param {string} mode   'text' | 'json'.
 * @return {void}
 */
function emit(report, mode) {
	if (mode === 'json') {
		process.stdout.write(JSON.stringify(report) + '\n');
		return;
	}
	const summary = report.summary;
	const failed =
		summary.failedUrls > 0 ? `, ${summary.failedUrls} failed to load` : '';
	const lines = [
		`${report.tool}: ${summary.issues} issue(s) across ${summary.urls} URL(s); ${summary.passedUrls} clean${failed}.`,
	];
	if (summary.worst) {
		lines.push(
			`worst: ${summary.worst.metric} ${summary.worst.value} (${summary.worst.rating}) on ${summary.worst.url}`
		);
	}
	for (const result of report.results) {
		lines.push('');
		if (result.scanError) {
			lines.push(`${result.url} — scan failed`);
			lines.push(`  ${result.scanError}`);
			continue;
		}
		lines.push(`${result.url}`);
		for (const line of result.assessment) {
			lines.push(`  ${line}`);
		}
		if (result.server) {
			const top = result.server.top
				.slice(0, 3)
				.map((entry) => `${entry.fn} (${entry.wallMs.toFixed(1)}ms)`)
				.join(', ');
			lines.push(`  server top: ${top || 'none'}`);
			if (result.server.error) {
				lines.push(`  server error: ${result.server.error}`);
			}
		}
		for (const note of result.notes) {
			lines.push(`  note: ${note}`);
		}
	}
	lines.push('');
	process.stdout.write(lines.join('\n'));
}

/**
 * Print CLI usage.
 *
 * @return {void}
 */
function printUsage() {
	process.stdout.write(
		[
			'Usage: perf [options]',
			'',
			'  Runs lab Core Web Vitals (web-vitals attribution build under headless',
			"  Chromium) and Lighthouse against the project perf config's URLs,",
			'  optionally profiling the server-side render via WP-CLI + xhprof, and',
			'  prints a normalized two-layer report. Requires the puppeteer and',
			'  web-vitals dev dependencies (`wp-tooling add setup/perf` sets these',
			'  up, along with lighthouse and the server-profile.php shim).',
			'',
			'  --config <path>        Path to the perf config (default: .perfrc.json).',
			"  --url <url>            Target URL; repeatable. Replaces the config's urls[] entirely.",
			'  --output <text|json>   Output format (default: text).',
			'  --dry-run              Print the resolved config, modules and URLs; run nothing.',
			'  --help, -h             Print this help.',
			'',
			'  A config is only required when no --url is given. INP is not',
			'  measurable in the lab layer (no user interaction is performed).',
			'',
			'Exit codes: 0 clean · 1 run failure or unreachable URL · 2 usage or binary missing · 3 issues found.',
			'',
		].join('\n')
	);
}

/**
 * Print the dry-run plan (resolved config, modules, binaries, URLs) without
 * running anything.
 *
 * @param {Object} opts Parsed options.
 * @param {string} cwd  Working directory.
 * @return {number} Exit code.
 */
function runDryRun(opts, cwd) {
	let resolved;
	try {
		resolved = resolveConfig({
			configPath: opts.configPath,
			urls: opts.urls,
			cwd,
		});
	} catch (err) {
		return handleError(err);
	}
	const { config, configPath, urls } = resolved;

	const puppeteerInfo = detectModule('puppeteer', { cwd });
	const webVitalsFile = resolveModuleFile('web-vitals', WEB_VITALS_DIST, {
		cwd,
	});

	const lines = [
		'[dry-run] perf would run:',
		`  config:      ${configPath || 'none — URLs from --url'}`,
		`  urls:        ${urls.join(', ')}`,
		`  puppeteer:   ${
			puppeteerInfo.available
				? `${puppeteerInfo.dir} (${puppeteerInfo.source}, ${puppeteerInfo.version})`
				: 'NOT FOUND'
		}`,
		`  web-vitals:  ${webVitalsFile || 'NOT FOUND'}`,
	];

	if (config.lighthouse.enabled) {
		const bin = detectBin(LIGHTHOUSE_BIN, { cwd });
		const state = bin.available ? bin.version : 'NOT FOUND';
		lines.push(`  lighthouse:  ${bin.command} (${bin.source}, ${state})`);
	} else {
		lines.push('  lighthouse:  disabled');
	}

	if (config.server.enabled) {
		const commandParts = Array.isArray(config.server.command)
			? config.server.command
			: [String(config.server.command)];
		lines.push(
			`  server:      ${commandParts.join(' ')} eval-file ${config.server.shim} <path> ${config.server.top} --url=<origin>`
		);
	} else {
		lines.push('  server:      disabled');
	}

	lines.push('');
	process.stdout.write(lines.join('\n'));
	return 0;
}

/**
 * Map a thrown error to an exit code and a stderr message.
 *
 * `EBADJSON` here is always `resolveConfig`'s "the project's own perf config
 * is malformed" — a usage error. `lighthouse.js` throws the same code for a
 * corrupted Lighthouse run, but that one is always caught and degraded
 * inside `collectOne`, so it never reaches this function.
 *
 * @param {Error} err The error.
 * @return {number} Exit code: 2 (usage / module or binary missing / bad config), 1 (run failure).
 */
function handleError(err) {
	process.stderr.write(`perf: ${err.message}\n`);
	if (
		err instanceof RunnerError &&
		(err.code === 'EBINMISSING' ||
			err.code === 'ENOURLS' ||
			err.code === 'EBADJSON')
	) {
		return 2;
	}
	return 1;
}

/**
 * Run the CLI. Returns the intended exit code.
 *
 * @param {string[]} argv argv slice (without `node` and script path).
 * @return {Promise<number>} 0 clean · 1 run failure or unreachable URL · 2 usage/module-missing · 3 issues found.
 */
async function runCli(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		process.stderr.write(`perf: ${err.message}\n`);
		return 2;
	}

	if (opts.help) {
		printUsage();
		return 0;
	}

	if (!VALID_OUTPUTS.includes(opts.output)) {
		process.stderr.write(
			`perf: invalid --output "${opts.output}" (expected one of: ${VALID_OUTPUTS.join(
				', '
			)})\n`
		);
		return 2;
	}

	const cwd = process.cwd();

	if (opts.dryRun) {
		return runDryRun(opts, cwd);
	}

	let report;
	try {
		report = await runPerf({
			configPath: opts.configPath,
			urls: opts.urls,
			cwd,
		});
	} catch (err) {
		return handleError(err);
	}

	emit(report, opts.output);
	if (report.summary.failedUrls > 0) {
		process.stderr.write(
			`perf: ${report.summary.failedUrls} URL(s) failed to load — treating as a run failure.\n`
		);
		return 1;
	}
	return report.summary.issues > 0 ? 3 : 0;
}

module.exports = { runPerf, runCli };

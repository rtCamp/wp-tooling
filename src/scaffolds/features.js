/**
 * `wp-tooling features` -- library + CLI implementation.
 *
 * The interactive feature manager: lists every toggleable feature (a scaffold
 * carrying a `feature` block), shows its current on/off state from
 * `.wp-tooling.json`, lets the developer flip it, and applies only the delta:
 *   - newly enabled  -> registry.enable()  (create files, set flag, gitignore)
 *                       then install the feature's reported deps — or, with
 *                       --no-install --record-deps, record them in
 *                       package.json so a later plain `npm install` picks
 *                       them up. Plain --no-install only reports them.
 *   - newly disabled -> registry.disable() (remove owned files, clear flag),
 *                       confirming before deleting developer-editable files.
 *
 * Modes:
 *   - Interactive (default): one confirm() per feature, defaulted to the
 *     current state (so "keep as is" is just Enter), then applies changes
 *     under a spinner.
 *   - Non-interactive: `--enable <id>` / `--disable <id>` (repeatable) apply
 *     named changes without prompts; `--json` prints status (or the applied
 *     result) as one JSON line. Mirrors the add.js CLI surface.
 *
 * The engine core (registry.js) stays TTY-free; this file is the only feature
 * module that imports the TTY UI kit, exactly like prompt-inputs.js for add.
 *
 * The `src/cli/commands/features.js` thin shim defers to `runCli` here.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ScaffoldError } = require('./registry');
const { detectIndent } = require('./config');
const {
	buildRegistry,
	fetchOptsFrom,
	requireFlagValue,
} = require('./cli-support');

function defaultOpts() {
	return {
		cwd: process.cwd(),
		json: false,
		nonInteractive: false,
		enable: [],
		disable: [],
		force: false,
		dryRun: false,
		install: true,
		record: false,
		refresh: false,
		cacheDir: undefined,
		help: false,
	};
}

function parseArgs(argv) {
	const opts = defaultOpts();
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		// Value of a space-separated flag (`--enable tailwind`); rejects a
		// missing or flag-shaped value rather than swallowing the next flag.
		const value = () => requireFlagValue(argv[++i], a);
		if (a === '--help' || a === '-h') {
			opts.help = true;
		} else if (a === '--json') {
			opts.json = true;
			opts.nonInteractive = true;
		} else if (a === '--non-interactive') {
			opts.nonInteractive = true;
		} else if (a === '--force') {
			opts.force = true;
		} else if (a === '--dry-run') {
			opts.dryRun = true;
		} else if (a === '--no-install') {
			opts.install = false;
		} else if (a === '--record-deps') {
			opts.record = true;
		} else if (a === '--refresh') {
			opts.refresh = true;
		} else if (a === '--enable') {
			opts.enable.push(value());
		} else if (a.startsWith('--enable=')) {
			opts.enable.push(a.slice('--enable='.length));
		} else if (a === '--disable') {
			opts.disable.push(value());
		} else if (a.startsWith('--disable=')) {
			opts.disable.push(a.slice('--disable='.length));
		} else if (a === '--cwd') {
			opts.cwd = value();
		} else if (a.startsWith('--cwd=')) {
			opts.cwd = a.slice('--cwd='.length);
		} else if (a === '--cache-dir') {
			opts.cacheDir = value();
		} else if (a.startsWith('--cache-dir=')) {
			opts.cacheDir = a.slice('--cache-dir='.length);
		} else {
			throw new Error(`Unexpected argument: ${a}`);
		}
	}
	// Explicit --enable/--disable apply the named changes directly, without the
	// per-feature interactive prompt.
	if (opts.enable.length > 0 || opts.disable.length > 0) {
		opts.nonInteractive = true;
	}
	return opts;
}

function printHelp() {
	process.stdout.write(
		[
			'Usage: wp-tooling features [flags]',
			'',
			'Toggle project features (Tailwind, etc.) on or off. With no flags, runs',
			'an interactive prompt per feature defaulted to its current state.',
			'',
			'Flags:',
			'  --enable <id>        Enable feature <id> (repeatable, non-interactive).',
			'  --disable <id>       Disable feature <id> (repeatable, non-interactive).',
			'  --force              On disable, remove developer-editable files without asking.',
			"  --no-install         Don't run npm install; deps are reported only.",
			'  --record-deps        With --no-install, record new deps in package.json',
			'                       so the next plain `npm install` picks them up.',
			'  --dry-run            Show what would change without writing.',
			'  --non-interactive    Never prompt; print status (or apply --enable/--disable).',
			'  --json               Emit one JSON line. Implies --non-interactive.',
			'  --cwd <path>         Target project directory (default: cwd).',
			'  --refresh            Force re-fetch of remote scaffold indexes.',
			'  --cache-dir <path>   Override the remote-template cache directory.',
			'  --help, -h           Show this help text.',
			'',
			'Examples:',
			'  wp-tooling features',
			'  wp-tooling features --enable tailwind',
			'  wp-tooling features --disable tailwind --force',
			'  wp-tooling features --json',
			'',
		].join('\n')
	);
}

/**
 * Install a feature's reported npm dev/prod dependencies. The engine only
 * reports deps; the feature manager is where they actually get installed.
 *
 * @param {Object}   install - The execute() result `developer.install` block.
 * @param {string}   cwd     - Project directory to install into.
 * @param {Function} [log]   - Optional progress logger.
 * @return {void}
 */
function installDeps(install, cwd, log) {
	const run = (pkgs, flag) => {
		if (pkgs.length === 0) {
			return;
		}
		const specs = pkgs.map(([p, v]) => `${p}@${v}`);
		if (log) {
			log(`npm install ${flag} ${specs.join(' ')}`);
		}
		try {
			// execFileSync (no shell): package names/versions come from a
			// scaffold manifest, which for a remote source is third-party
			// content. Passing them as argv elements — never interpolated
			// into a shell string — closes the command-injection vector.
			execFileSync('npm', ['install', flag, ...specs], {
				cwd,
				stdio: 'pipe',
			});
		} catch (err) {
			// stdio:'pipe' swallows npm's stderr; surface its tail so the
			// developer sees why the install failed, not just "exit 1".
			const stderr = err.stderr ? String(err.stderr).trim() : '';
			const tail = stderr.split('\n').slice(-5).join('\n');
			throw new ScaffoldError(
				'EINSTALLFAIL',
				`npm install ${flag} ${specs.join(' ')} failed${tail ? `:\n${tail}` : ` (${err.message})`}`,
				{ packages: specs }
			);
		}
	};
	run(Object.entries(install.npm || {}), '--save');
	run(Object.entries(install.npmDev || {}), '--save-dev');
}

/**
 * Record a feature's npm deps in package.json WITHOUT installing them — the
 * opt-in (`--no-install --record-deps` / `install: false, record: true`)
 * counterpart of {@link installDeps}. Used when the feature manager runs
 * inside another `npm install` (e.g. a theme's `prepare` hook), so the next
 * plain `npm install` picks the deps up.
 *
 * Only missing entries are added (an existing version range chosen by the
 * developer is never overwritten), keys stay sorted, and the file's existing
 * indentation is preserved.
 *
 * @param {Object}   install - The execute() result `developer.install` block.
 * @param {string}   cwd     - Project directory whose package.json to update.
 * @param {Function} [log]   - Optional progress logger.
 * @return {string[]} `name@version` specs newly added to package.json.
 */
function recordDeps(install, cwd, log) {
	const pkgPath = path.join(cwd, 'package.json');
	let raw;
	try {
		raw = fs.readFileSync(pkgPath, 'utf8');
	} catch {
		return []; // no package.json — nothing to record into
	}
	let pkg;
	try {
		pkg = JSON.parse(raw);
	} catch {
		return []; // malformed — leave it alone
	}

	const added = [];
	const merge = (field, deps) => {
		const entries = Object.entries(deps || {});
		if (entries.length === 0) {
			return;
		}
		const target = { ...(pkg[field] || {}) };
		for (const [name, version] of entries) {
			if (name in target) {
				continue;
			}
			target[name] = version;
			added.push(`${name}@${version}`);
		}
		pkg[field] = Object.fromEntries(
			Object.keys(target)
				.sort()
				.map((k) => [k, target[k]])
		);
	};
	merge('dependencies', install.npm);
	merge('devDependencies', install.npmDev);

	if (added.length === 0) {
		return [];
	}
	const indent = detectIndent(raw) || 2;
	const eol = raw.endsWith('\n') ? '\n' : '';
	fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + eol, 'utf8');
	if (log) {
		log(`recorded ${added.join(', ')} in package.json`);
	}
	return added;
}

/**
 * Apply one feature change against the registry, returning a plain summary.
 *
 * @param {Object} registry - Scanned ScaffoldRegistry.
 * @param {Object} change   - { id, configKey, target: boolean }.
 * @param {Object} opts     - Parsed CLI opts.
 * @param {Object} io       - { confirmRemove, log } callbacks (optional).
 * @return {Promise<Object>} Summary of the change.
 */
async function applyChange(registry, change, opts, io = {}) {
	const cwd = path.resolve(opts.cwd);
	if (change.target) {
		const result = await registry.enable(
			change.id,
			{},
			{ cwd, dryRun: opts.dryRun, fetchOpts: fetchOptsFrom(opts) }
		);
		// Deps are installed right away, or — when installing is off AND the
		// caller opted in via --record-deps (e.g. init running inside
		// `npm install`) — recorded in package.json so the next plain
		// `npm install` brings them in. Plain --no-install reports only:
		// an AI orchestrator handling consent itself must get no
		// package.json edit it did not ask for.
		let recorded = [];
		let installed = false;
		let installError;
		if (!opts.dryRun) {
			if (opts.install) {
				// enable() has already created files + persisted state, so a
				// failed install must not unwind it: report the feature as
				// enabled-but-not-installed instead of throwing the enable
				// away (a re-run is idempotent and would skip the install).
				try {
					installDeps(result.developer.install, cwd, io.log);
					installed = true;
				} catch (err) {
					installError = err.message || String(err);
					if (io.warn) {
						io.warn(installError);
					}
				}
			} else if (opts.record) {
				recorded = recordDeps(result.developer.install, cwd, io.log);
			}
		}
		return {
			id: change.id,
			action: 'enabled',
			wrote: result.engine.wrote,
			install: result.developer.install,
			installed,
			installError,
			recorded,
		};
	}
	const result = await registry.disable(change.id, {
		cwd,
		dryRun: opts.dryRun,
		confirmRemove: io.confirmRemove,
	});
	return {
		id: change.id,
		action: 'disabled',
		removed: result.removed,
		kept: result.kept,
		missing: result.missing,
	};
}

async function runInteractive(opts) {
	// Lazy require so non-interactive callers never load TTY UI.
	const { confirm, spinner } = require('../ui');

	const cwd = path.resolve(opts.cwd);
	const registry = await buildRegistry(cwd, fetchOptsFrom(opts));
	const features = registry.status(cwd);

	if (features.length === 0) {
		process.stdout.write('No toggleable features are available.\n');
		return 0;
	}

	const changes = [];
	for (const f of features) {
		const want = await confirm({
			message: `${f.name} — ${f.description} [currently ${
				f.enabled ? 'on' : 'off'
			}]. Enable?`,
			defaultValue: f.enabled,
		});
		if (want !== f.enabled) {
			changes.push({ id: f.id, configKey: f.configKey, target: want });
		}
	}

	if (changes.length === 0) {
		process.stdout.write('\nNo changes.\n');
		return 0;
	}

	const confirmRemove = (file) =>
		confirm({
			message: `Delete developer-editable file ${file}?`,
			defaultValue: false,
		});

	const summaries = [];
	for (const change of changes) {
		const verb = change.target ? 'Enabling' : 'Disabling';
		const s = spinner(`${verb} ${change.id}...`);
		s.start();
		try {
			const summary = await applyChange(registry, change, opts, {
				confirmRemove,
				log: (m) => s.update(m),
			});
			s.succeed(`${summary.action} ${change.id}`);
			summaries.push(summary);
		} catch (err) {
			s.fail(`Failed to ${verb.toLowerCase()} ${change.id}`);
			throw err;
		}
	}

	printHumanReport(summaries, opts);
	return 0;
}

async function runNonInteractive(opts) {
	const cwd = path.resolve(opts.cwd);
	const registry = await buildRegistry(cwd, fetchOptsFrom(opts));
	const features = registry.status(cwd);
	// Accept either the full `category/slug` id or the bare slug.
	const byId = new Map();
	for (const f of features) {
		byId.set(f.id, f);
		byId.set(f.slug, f);
	}

	// No explicit changes requested: report status.
	if (opts.enable.length === 0 && opts.disable.length === 0) {
		if (opts.json) {
			process.stdout.write(JSON.stringify({ features }) + '\n');
		} else {
			printStatus(features);
		}
		return 0;
	}

	const changes = [];
	for (const id of opts.enable) {
		changes.push({ id, target: true });
	}
	for (const id of opts.disable) {
		changes.push({ id, target: false });
	}

	// In non-interactive disable, only delete developer-editable files with --force.
	const confirmRemove = () => Promise.resolve(opts.force);

	const summaries = [];
	for (const change of changes) {
		if (!byId.has(change.id)) {
			throw new ScaffoldError(
				'ENOTFEATURE',
				`No toggleable feature: ${change.id}`,
				{ requested: change.id, available: features.map((f) => f.id) }
			);
		}
		summaries.push(
			await applyChange(registry, change, opts, { confirmRemove })
		);
	}

	if (opts.json) {
		process.stdout.write(JSON.stringify({ changes: summaries }) + '\n');
	} else {
		printHumanReport(summaries, opts);
	}
	return 0;
}

function printStatus(features) {
	const writeln = (s) => process.stdout.write(`${s}\n`);
	writeln(`Features (${features.length}):`);
	for (const f of features) {
		writeln(`  [${f.enabled ? 'x' : ' '}] ${f.id} — ${f.name}`);
	}
	writeln(
		'\nToggle with `wp-tooling features` or `--enable/--disable <id>`.'
	);
}

function printHumanReport(summaries, opts) {
	const writeln = (s) => process.stdout.write(`${s}\n`);
	for (const s of summaries) {
		writeln(`${s.action}: ${s.id}${opts.dryRun ? ' (dry run)' : ''}`);
		if (s.action === 'enabled') {
			for (const p of s.wrote || []) {
				writeln(`  + ${p}`);
			}
			const dev = Object.entries(s.install.npmDev || {});
			const prod = Object.entries(s.install.npm || {});
			if (s.installError) {
				writeln(`  ! enabled, but npm install failed:`);
				for (const line of s.installError.split('\n')) {
					writeln(`    ${line}`);
				}
				writeln(
					'  re-run the install yourself once the cause is fixed:'
				);
				for (const [p, v] of [...prod, ...dev]) {
					writeln(`    npm install --save-dev ${p}@${v}`);
				}
			} else if (s.installed) {
				for (const [p, v] of [...prod, ...dev]) {
					writeln(`  installed ${p}@${v}`);
				}
			} else if ((s.recorded || []).length > 0) {
				for (const spec of s.recorded) {
					writeln(`  recorded ${spec} in package.json`);
				}
				writeln('  run `npm install` to install the recorded deps');
			} else {
				// Dry run (or nothing new to record): suggest the commands.
				for (const [p, v] of prod) {
					writeln(`  npm install ${p}@${v}`);
				}
				for (const [p, v] of dev) {
					writeln(`  npm install --save-dev ${p}@${v}`);
				}
			}
		} else {
			for (const p of s.removed || []) {
				writeln(`  - ${p}`);
			}
			for (const p of s.kept || []) {
				writeln(`  = kept ${p}`);
			}
		}
	}
	writeln('Done.');
}

async function runCli(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		process.stderr.write(`Error: ${err.message}\n`);
		printHelp();
		return 1;
	}
	if (opts.help) {
		printHelp();
		return 0;
	}
	try {
		return opts.nonInteractive
			? await runNonInteractive(opts)
			: await runInteractive(opts);
	} catch (err) {
		if (err && err.name === 'CancelledError') {
			throw err; // dispatcher maps to exit 130
		}
		if (opts.json) {
			process.stderr.write(
				JSON.stringify({
					code: err.code || 'EUNKNOWN',
					message: err.message || String(err),
				}) + '\n'
			);
		} else {
			process.stderr.write(
				`Error: ${err && err.message ? err.message : err}\n`
			);
		}
		return 1;
	}
}

/**
 * Programmatic entry point for embedding the feature manager in another tool
 * (e.g. theme-elementary's `bin/init.js`) — same in-process TTY UI flow as the
 * CLI, no subprocess. Throws `CancelledError` on Ctrl+C so the host can handle
 * it. By default runs the interactive prompt-per-feature flow.
 *
 * @param {Object}   [options]                Options (override the parsed-CLI defaults).
 * @param {string}   [options.cwd]            Target project directory.
 * @param {boolean}  [options.install=true]   Run npm install for newly enabled features; when false, deps are reported only.
 * @param {boolean}  [options.record=false]   With install:false, record new deps in package.json (for init flows running inside `npm install`).
 * @param {boolean}  [options.nonInteractive] Skip prompts (apply enable/disable arrays / print status).
 * @param {string[]} [options.enable]         Feature ids to enable (implies non-interactive).
 * @param {string[]} [options.disable]        Feature ids to disable (implies non-interactive).
 * @param {boolean}  [options.force]          On disable, remove developer-editable files without asking.
 * @param {boolean}  [options.dryRun]         Show changes without writing.
 * @return {Promise<number>} Exit-style code (0 on success).
 */
async function runFeatures(options = {}) {
	const opts = { ...defaultOpts(), ...options };
	if (opts.enable.length > 0 || opts.disable.length > 0) {
		opts.nonInteractive = true;
	}
	return opts.nonInteractive ? runNonInteractive(opts) : runInteractive(opts);
}

module.exports = {
	runCli,
	runFeatures,
	parseArgs,
	printHelp,
	buildRegistry,
	applyChange,
	recordDeps,
};

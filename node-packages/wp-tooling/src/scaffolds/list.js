/**
 * `wp-tooling list` -- library + CLI implementation.
 *
 * Lists every scaffold visible from the current working directory's merged
 * catalogue (wp-tooling's bundled defaults + the project's `bin/scaffolds/`).
 * Two output modes:
 *   - Human-readable (default): grouped by category, with id / name / kind /
 *     origin / one-line description.
 *   - JSON (`--json`): one object per scaffold with id, kind, origin,
 *     description, and counts (inputs, wiring, tests, secrets) so an AI can
 *     decide what to add without reading every scaffold.json. Skills can
 *     follow up with `add ... --dry-run --json` for full per-scaffold detail.
 *
 * The `src/cli/commands/list.js` thin shim defers to `runCli` here.
 *
 * Implements:
 *   WTL-06  CLI surface adjacent to `add` (same registry, same dispatcher)
 */

'use strict';

const {
	buildRegistry,
	fetchOptsFrom,
	requireFlagValue,
} = require('./cli-support');

function parseArgs(argv) {
	const opts = {
		json: false,
		cwd: process.cwd(),
		category: null,
		origin: null,
		refresh: false,
		cacheDir: null,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		// Value of a space-separated flag; rejects a missing or flag-shaped
		// value rather than swallowing the next flag.
		const value = () => requireFlagValue(argv[++i], a);
		if (a === '--help' || a === '-h') {
			opts.help = true;
		} else if (a === '--json') {
			opts.json = true;
		} else if (a === '--cwd') {
			opts.cwd = value();
		} else if (a.startsWith('--cwd=')) {
			opts.cwd = a.slice('--cwd='.length);
		} else if (a === '--category') {
			opts.category = value();
		} else if (a.startsWith('--category=')) {
			opts.category = a.slice('--category='.length);
		} else if (a === '--origin') {
			opts.origin = value();
		} else if (a.startsWith('--origin=')) {
			opts.origin = a.slice('--origin='.length);
		} else if (a === '--refresh') {
			opts.refresh = true;
		} else if (a === '--cache-dir') {
			opts.cacheDir = value();
		} else if (a.startsWith('--cache-dir=')) {
			opts.cacheDir = a.slice('--cache-dir='.length);
		} else {
			throw new Error(`Unexpected argument: ${a}`);
		}
	}
	return opts;
}

function printHelp() {
	process.stdout.write(
		[
			'Usage: wp-tooling list [flags]',
			'',
			'Flags:',
			'  --category <name>    Show only scaffolds in this category (e.g., wp, ci, block, utility).',
			'  --origin <default|project|remote>  Show only default-catalogue, project-local, or remote (sources) scaffolds.',
			'  --json               Emit machine-readable JSON instead of the human table.',
			'  --cwd <path>         Project directory whose bin/scaffolds is merged in (default: cwd).',
			'  --refresh            Bypass the remote-index cache and re-fetch.',
			'  --cache-dir <path>   Override the remote-fetch cache directory.',
			'  --help, -h           Show this help text.',
			'',
			'Examples:',
			'  wp-tooling list',
			'  wp-tooling list --category=ci',
			'  wp-tooling list --json',
			'  wp-tooling list --origin=project --cwd=/path/to/plugin',
			'',
		].join('\n')
	);
}

function makeId(s) {
	return s.category ? `${s.category}/${s.slug}` : s.slug;
}

function applyFilters(scaffolds, opts) {
	let out = scaffolds;
	if (opts.category) {
		out = out.filter((s) => (s.category || '') === opts.category);
	}
	if (opts.origin) {
		out = out.filter((s) => s.origin === opts.origin);
	}
	return out;
}

function summarise(scaffold) {
	// Remote (sources) scaffolds are listed from the repo index without
	// fetching each manifest, so their detailed counts are unknown until
	// `add`. They render Mustache like any template scaffold.
	if (scaffold.origin === 'remote') {
		return {
			id: makeId(scaffold),
			slug: scaffold.slug,
			category: scaffold.category || null,
			name: scaffold.name,
			description: scaffold.description,
			kind: 'template',
			origin: 'remote',
			counts: null,
			// Remote manifests are not fetched during `list`, so the full input
			// schema is unknown until `add` hydrates them (mirrors `counts: null`).
			inputs: null,
		};
	}
	return {
		id: makeId(scaffold),
		slug: scaffold.slug,
		category: scaffold.category || null,
		name: scaffold.name,
		description: scaffold.description,
		kind: scaffold.source === 'package' ? 'package' : 'template',
		origin: scaffold.origin,
		counts: {
			inputs: Array.isArray(scaffold.inputs) ? scaffold.inputs.length : 0,
			wiring: Array.isArray(scaffold.wiring) ? scaffold.wiring.length : 0,
			tests: Array.isArray(scaffold.tests) ? scaffold.tests.length : 0,
			secrets: Array.isArray(scaffold.secrets)
				? scaffold.secrets.length
				: 0,
			scripts: scaffold.scripts
				? Object.values(scaffold.scripts).reduce(
						(n, m) => n + Object.keys(m || {}).length,
						0
					)
				: 0,
		},
		// Full input schema, so a caller (including an AI agent) has every input's
		// key/required/default/discover_from/description without running a
		// `--dry-run` add and parsing the EMISSINGINPUT error to discover them.
		inputs: Array.isArray(scaffold.inputs)
			? scaffold.inputs.map((d) => ({
					key: d.key,
					required: !!d.required,
					default: d.default ?? null,
					discover_from: d.discover_from ?? null,
					transform: d.transform ?? null,
					description: d.description,
				}))
			: [],
	};
}

function printHumanTable(summaries) {
	const writeln = (s) => process.stdout.write(`${s}\n`);
	if (summaries.length === 0) {
		writeln('No scaffolds match the given filters.');
		return;
	}

	const byCategory = new Map();
	for (const s of summaries) {
		const key = s.category || '(uncategorised)';
		if (!byCategory.has(key)) {
			byCategory.set(key, []);
		}
		byCategory.get(key).push(s);
	}

	const idWidth = Math.max(8, ...summaries.map((s) => s.id.length));

	writeln(`Available scaffolds (${summaries.length}):`);

	const categories = Array.from(byCategory.keys()).sort();
	for (const cat of categories) {
		writeln(`\n  ${cat.toUpperCase()}`);
		for (const s of byCategory
			.get(cat)
			.sort((a, b) => a.id.localeCompare(b.id))) {
			const id = s.id.padEnd(idWidth);
			const meta = `${s.kind.padEnd(8)} ${s.origin.padEnd(7)}`;
			const counts = formatCounts(s.counts);
			writeln(`    ${id}  ${meta}  ${s.name}`);
			writeln(
				`    ${' '.repeat(idWidth)}  ${' '.repeat(meta.length)}  ${
					s.description
				}`
			);
			if (counts) {
				writeln(
					`    ${' '.repeat(idWidth)}  ${' '.repeat(meta.length)}  ${counts}`
				);
			}
		}
	}

	writeln('\nRun `wp-tooling add <id> --help` to scaffold one.');
}

function formatCounts(counts) {
	if (!counts) {
		return '';
	}
	const parts = [];
	if (counts.inputs) {
		parts.push(`inputs:${counts.inputs}`);
	}
	if (counts.wiring) {
		parts.push(`wiring:${counts.wiring}`);
	}
	if (counts.tests) {
		parts.push(`tests:${counts.tests}`);
	}
	if (counts.secrets) {
		parts.push(`secrets:${counts.secrets}`);
	}
	if (counts.scripts) {
		parts.push(`scripts:${counts.scripts}`);
	}
	return parts.length ? parts.join(' ') : '';
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
	if (
		opts.origin &&
		!['default', 'project', 'remote'].includes(opts.origin)
	) {
		process.stderr.write(
			`Error: --origin must be 'default', 'project', or 'remote' (got '${opts.origin}')\n`
		);
		return 1;
	}
	try {
		const warnings = [];
		const fetchOpts = { ...fetchOptsFrom(opts), warnings };
		const registry = await buildRegistry(opts.cwd, fetchOpts);
		const all = registry.all();
		const filtered = applyFilters(all, opts);
		const summaries = filtered.map(summarise);
		if (opts.json) {
			process.stdout.write(
				JSON.stringify({ scaffolds: summaries, warnings }) + '\n'
			);
		} else {
			printHumanTable(summaries);
			for (const w of warnings) {
				process.stderr.write(`warning: ${w}\n`);
			}
		}
		return 0;
	} catch (err) {
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

module.exports = {
	runCli,
	parseArgs,
	printHelp,
	buildRegistry,
	summarise,
};

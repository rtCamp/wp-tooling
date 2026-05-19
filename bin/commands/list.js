/**
 * `wp-tooling list` subcommand.
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
 * Implements:
 *   WTL-06  CLI surface adjacent to `add` (same registry, same dispatcher)
 */

'use strict';

const path = require('path');
const {
	ScaffoldRegistry,
} = require('../../src/scaffolds/registry');

const description = 'List all available scaffolds in the merged catalogue.';

function parseArgs(argv) {
	const opts = {
		json: false,
		cwd: process.cwd(),
		category: null,
		origin: null,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--help' || a === '-h') {
			opts.help = true;
		} else if (a === '--json') {
			opts.json = true;
		} else if (a === '--cwd') {
			opts.cwd = argv[++i];
		} else if (a.startsWith('--cwd=')) {
			opts.cwd = a.slice('--cwd='.length);
		} else if (a === '--category') {
			opts.category = argv[++i];
		} else if (a.startsWith('--category=')) {
			opts.category = a.slice('--category='.length);
		} else if (a === '--origin') {
			opts.origin = argv[++i];
		} else if (a.startsWith('--origin=')) {
			opts.origin = a.slice('--origin='.length);
		} else {
			throw new Error(`Unexpected argument: ${a}`);
		}
	}
	return opts;
}

function printHelp() {
	console.log(
		[
			'Usage: wp-tooling list [flags]',
			'',
			'Flags:',
			'  --category <name>    Show only scaffolds in this category (e.g., wp, ci, block, utility).',
			'  --origin <default|project>  Show only default-catalogue or only project-local scaffolds.',
			'  --json               Emit machine-readable JSON instead of the human table.',
			'  --cwd <path>         Project directory whose bin/scaffolds is merged in (default: cwd).',
			'  --help, -h           Show this help text.',
			'',
			'Examples:',
			'  wp-tooling list',
			'  wp-tooling list --category=ci',
			'  wp-tooling list --json',
			'  wp-tooling list --origin=project --cwd=/path/to/plugin',
		].join('\n')
	);
}

function defaultsDir() {
	return path.join(__dirname, '..', '..', 'scaffolds');
}

function projectDir(cwd) {
	return path.join(cwd, 'bin', 'scaffolds');
}

async function buildRegistry(cwd) {
	const registry = new ScaffoldRegistry({
		defaultsDir: defaultsDir(),
		projectDir: projectDir(cwd),
	});
	await registry.scan();
	return registry;
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
			secrets: Array.isArray(scaffold.secrets) ? scaffold.secrets.length : 0,
		},
	};
}

function printHumanTable(summaries) {
	if (summaries.length === 0) {
		console.log('No scaffolds match the given filters.');
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

	const idWidth = Math.max(
		8,
		...summaries.map((s) => s.id.length)
	);

	console.log(`Available scaffolds (${summaries.length}):`);

	const categories = Array.from(byCategory.keys()).sort();
	for (const cat of categories) {
		console.log(`\n  ${cat.toUpperCase()}`);
		for (const s of byCategory.get(cat).sort((a, b) => a.id.localeCompare(b.id))) {
			const id = s.id.padEnd(idWidth);
			const meta = `${s.kind.padEnd(8)} ${s.origin.padEnd(7)}`;
			const counts = formatCounts(s.counts);
			console.log(`    ${id}  ${meta}  ${s.name}`);
			console.log(`    ${' '.repeat(idWidth)}  ${' '.repeat(meta.length)}  ${s.description}`);
			if (counts) {
				console.log(`    ${' '.repeat(idWidth)}  ${' '.repeat(meta.length)}  ${counts}`);
			}
		}
	}

	console.log('\nRun `wp-tooling add <id> --help` to scaffold one.');
}

function formatCounts(counts) {
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
	return parts.length ? parts.join(' ') : '';
}

async function run(argv) {
	const opts = parseArgs(argv);
	if (opts.help) {
		printHelp();
		return 0;
	}
	if (opts.origin && !['default', 'project'].includes(opts.origin)) {
		console.error(`Error: --origin must be 'default' or 'project' (got '${opts.origin}')`);
		return 1;
	}
	try {
		const registry = await buildRegistry(opts.cwd);
		const all = registry.all();
		const filtered = applyFilters(all, opts);
		const summaries = filtered.map(summarise);
		if (opts.json) {
			process.stdout.write(JSON.stringify({ scaffolds: summaries }) + '\n');
		} else {
			printHumanTable(summaries);
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
			console.error(`Error: ${err && err.message ? err.message : err}`);
		}
		return 1;
	}
}

module.exports = { run, description };

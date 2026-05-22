/**
 * `wp-tooling validate` subcommand.
 *
 * Validates scaffolds in the bundled catalogue and (optionally) the
 * current project's `bin/scaffolds/`. Intended for scaffold authors
 * to quickly check a newly added or modified scaffold without running
 * the full test suite.
 *
 *   wp-tooling validate                     # validate the whole catalogue
 *   wp-tooling validate wp/cli              # validate one scaffold by id
 *   wp-tooling validate --cwd /path/to/proj # also include project-local scaffolds
 *   wp-tooling validate --json              # machine-readable output
 *
 * Implements:
 *   WTL-11  validate subcommand for scaffold authoring ergonomics
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { validate } = require('../../src/scaffolds/validate');
const { render, collectPlaceholders } = require('../../src/scaffolds/render');

const description = 'Validate scaffold manifests in the catalogue.';

function parseArgs(argv) {
	const opts = { ids: [], cwd: null, json: false, help: false };
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
		} else if (a.startsWith('--')) {
			throw new Error(`Unexpected flag: ${a}`);
		} else {
			opts.ids.push(a);
		}
	}
	return opts;
}

function printHelp() {
	console.log(
		[
			'Usage: wp-tooling validate [scaffold-id...] [flags]',
			'',
			'Validates scaffold manifests. With no id, checks the whole bundled catalogue.',
			'With one or more ids (e.g. wp/cli, lint/phpcs/vip), only those are checked.',
			'',
			'Flags:',
			'  --cwd <path>   Also include project-local scaffolds at <path>/bin/scaffolds.',
			'  --json         Machine-readable output.',
			'  --help, -h     Show this help.',
			'',
			'Exit code: 0 if all valid, 1 if any errors.',
		].join('\n')
	);
}

function defaultsDir() {
	return path.join(__dirname, '..', '..', 'scaffolds');
}

function projectDir(cwd) {
	return path.join(cwd, 'bin', 'scaffolds');
}

function findScaffoldJsons(root) {
	const out = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch (err) {
			if (err.code === 'ENOENT') return;
			throw err;
		}
		for (const entry of entries) {
			const child = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(child);
			} else if (entry.isFile() && entry.name === 'scaffold.json') {
				out.push(child);
			}
		}
	};
	walk(root);
	return out;
}

function makeId(parsed) {
	return parsed.category ? `${parsed.category}/${parsed.slug}` : parsed.slug;
}

function checkTemplatesExist(scaffold, scaffoldDir) {
	const errs = [];
	const checkFile = (src, kind) => {
		if (typeof src !== 'string') return;
		const abs = path.join(scaffoldDir, src);
		if (!fs.existsSync(abs)) {
			errs.push(`${kind} template not found on disk: ${src}`);
		}
	};
	for (const file of scaffold.files || []) checkFile(file.src, 'files[]');
	for (const test of scaffold.tests || []) checkFile(test.src, 'tests[]');
	return errs;
}

function checkTemplatesRender(scaffold, scaffoldDir) {
	const errs = [];
	const declared = new Set(
		(scaffold.inputs || []).map((i) => i.key)
	);
	const supply = {};
	for (const i of scaffold.inputs || []) {
		supply[i.key] = i.default !== undefined ? i.default : 'x';
	}
	const tryRender = (src, kind) => {
		if (typeof src !== 'string') return;
		const abs = path.join(scaffoldDir, src);
		if (!fs.existsSync(abs)) return;
		const tpl = fs.readFileSync(abs, 'utf8');
		const missing = collectPlaceholders(tpl).filter(
			(k) => !(k in supply)
		);
		for (const k of missing) supply[k] = 'x';
		try {
			render(tpl, supply);
		} catch (err) {
			errs.push(`${kind} render failed for ${src}: ${err.message}`);
		}
	};
	for (const file of scaffold.files || []) tryRender(file.src, 'files[]');
	for (const test of scaffold.tests || []) tryRender(test.src, 'tests[]');
	// Wiring snippets render too.
	for (const w of scaffold.wiring || []) {
		try {
			const missing = collectPlaceholders(w.snippet_template).filter(
				(k) => !(k in supply)
			);
			for (const k of missing) supply[k] = 'x';
			render(w.snippet_template, supply);
		} catch (err) {
			errs.push(`wiring snippet_template render failed: ${err.message}`);
		}
	}
	// Eslint hint: declared but unused inputs are noisy, skip; we only flag errors here.
	void declared;
	return errs;
}

function validateOne(file) {
	const result = { file, id: null, valid: true, errors: [] };
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (err) {
		result.valid = false;
		result.errors.push(`Invalid JSON: ${err.message}`);
		return result;
	}
	result.id = makeId(parsed);
	const schemaErrors = validate(parsed);
	if (schemaErrors.length) {
		result.valid = false;
		result.errors.push(...schemaErrors);
	}
	const dir = path.dirname(file);
	const missingTpl = checkTemplatesExist(parsed, dir);
	if (missingTpl.length) {
		result.valid = false;
		result.errors.push(...missingTpl);
	}
	const renderErrs = checkTemplatesRender(parsed, dir);
	if (renderErrs.length) {
		result.valid = false;
		result.errors.push(...renderErrs);
	}
	return result;
}

function collectFiles(opts) {
	const files = findScaffoldJsons(defaultsDir());
	if (opts.cwd) {
		files.push(...findScaffoldJsons(projectDir(opts.cwd)));
	}
	return files;
}

function filterByIds(results, ids) {
	if (!ids.length) return results;
	const wanted = new Set(ids);
	return results.filter((r) => wanted.has(r.id));
}

function printHuman(results, ids) {
	const filtered = ids.length ? results : results;
	const totals = { valid: 0, invalid: 0 };
	for (const r of filtered) {
		if (r.valid) {
			totals.valid++;
			console.log(`ok   ${r.id || '(unknown)'}`);
		} else {
			totals.invalid++;
			console.log(`FAIL ${r.id || '(unknown)'}  (${r.file})`);
			for (const e of r.errors) console.log(`     - ${e}`);
		}
	}
	console.log('');
	console.log(`Total: ${filtered.length}  valid: ${totals.valid}  invalid: ${totals.invalid}`);
}

async function run(argv) {
	let opts;
	try {
		opts = parseArgs(argv);
	} catch (err) {
		console.error(`Error: ${err.message}`);
		return 1;
	}
	if (opts.help) {
		printHelp();
		return 0;
	}
	const files = collectFiles(opts);
	const allResults = files.map(validateOne);
	const results = filterByIds(allResults, opts.ids);
	if (opts.ids.length && results.length === 0) {
		const available = allResults.map((r) => r.id).filter(Boolean);
		const err = `No scaffolds matched: ${opts.ids.join(', ')}`;
		if (opts.json) {
			process.stderr.write(
				JSON.stringify({ code: 'ENOSCAFFOLD', message: err, available }) +
					'\n'
			);
		} else {
			console.error(`Error: ${err}`);
			console.error(`Available ids: ${available.join(', ')}`);
		}
		return 1;
	}
	const anyInvalid = results.some((r) => !r.valid);
	if (opts.json) {
		process.stdout.write(JSON.stringify({ results }) + '\n');
	} else {
		printHuman(results, opts.ids);
	}
	return anyInvalid ? 1 : 0;
}

module.exports = { run, description };

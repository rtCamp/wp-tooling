/**
 * Renders every bundled `ci/*` scaffold and checks the generated workflow
 * against the reusable workflow it calls in rtCamp/wp-shared-workflows.
 *
 * actionlint cannot see a remote reusable workflow's inputs, so a template
 * that passes a misspelt input, or leaves out a required one, renders a file
 * that lints clean and then fails before any job starts. These tests compare
 * each job's `with:` and `secrets:` keys with a snapshot of the `v1`
 * workflow_call contracts (tests/fixtures/wp-shared-workflows-v1-contracts.json),
 * and catch an empty `with:` block, which an optional input left out by its
 * section can produce.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ScaffoldRegistry } = require('../../src/scaffolds/registry');

const DEFAULTS_DIR = path.join(__dirname, '..', '..', 'scaffolds');
const CI_DIR = path.join(DEFAULTS_DIR, 'ci');
const CONTRACTS = require('../fixtures/wp-shared-workflows-v1-contracts.json');

const USES_RE =
	/^rtCamp\/wp-shared-workflows\/\.github\/workflows\/([\w.-]+\.yml)@(.+)$/;

const tempDirs = [];

function makeTmpDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-ci-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

let registry;
beforeAll(async () => {
	registry = new ScaffoldRegistry({ defaultsDir: DEFAULTS_DIR });
	await registry.scan();
});

/**
 * Every bundled ci/* scaffold, with values for its required inputs and
 * whether it declares node_version.
 */
const CI_SCAFFOLDS = fs
	.readdirSync(CI_DIR)
	.filter((name) => fs.existsSync(path.join(CI_DIR, name, 'scaffold.json')))
	.sort()
	.map((name) => {
		const manifest = JSON.parse(
			fs.readFileSync(path.join(CI_DIR, name, 'scaffold.json'), 'utf8')
		);
		const required = {};
		for (const input of manifest.inputs || []) {
			if (input.required && undefined === input.default) {
				required[input.key] = 'acme-plugin';
			}
		}
		const hasNodeVersion = (manifest.inputs || []).some(
			(input) => 'node_version' === input.key
		);
		return { id: `ci/${name}`, required, hasNodeVersion };
	});

/**
 * Reads the jobs that call a reusable workflow, with the keys under their
 * `with:` and `secrets:` blocks. The templates are plain block YAML, so
 * indentation is enough to find them.
 *
 * @param {string} yaml Rendered workflow.
 * @return {Array<Object>} One entry per calling job.
 */
function readCalls(yaml) {
	const lines = yaml.split('\n');
	const calls = [];
	let current = null;
	let block = null;
	let blockIndent = 0;

	for (const line of lines) {
		if (!line.trim() || line.trim().startsWith('#')) {
			continue;
		}
		const indent = line.length - line.trimStart().length;
		const text = line.trim();

		if (block && indent <= blockIndent) {
			block = null;
		}

		const uses = text.match(/^uses:\s*(\S+)$/);
		if (uses && 4 === indent) {
			current = { uses: uses[1], with: [], secrets: [] };
			calls.push(current);
			continue;
		}
		if (current && 4 === indent && /^(with|secrets):$/.test(text)) {
			block = text.slice(0, -1);
			blockIndent = indent;
			continue;
		}
		if (current && block && indent === blockIndent + 2) {
			current[block].push(text.split(':')[0]);
		}
		if (2 === indent) {
			current = null;
			block = null;
		}
	}
	return calls;
}

async function renderAll(id, inputs) {
	const cwd = makeTmpDir();
	await registry.execute(id, inputs, { dryRun: false, cwd });
	const dir = path.join(cwd, '.github', 'workflows');
	return fs
		.readdirSync(dir)
		.map((file) => fs.readFileSync(path.join(dir, file), 'utf8'));
}

describe('bundled ci/* scaffolds render workflows that match wp-shared-workflows v1', () => {
	it('finds the ci scaffolds', () => {
		expect(CI_SCAFFOLDS.length).toBeGreaterThan(5);
	});

	const cases = [];
	for (const scaffold of CI_SCAFFOLDS) {
		cases.push([scaffold.id, 'defaults', scaffold.required]);
		if (scaffold.hasNodeVersion) {
			cases.push([
				scaffold.id,
				'node_version 24',
				{ ...scaffold.required, node_version: '24' },
			]);
		}
	}

	it.each(cases)('%s with %s', async (id, _label, inputs) => {
		const files = await renderAll(id, inputs);
		expect(files.length).toBeGreaterThan(0);

		for (const yaml of files) {
			// No unrendered placeholder or section tag.
			expect(yaml).not.toMatch(/\{\{[#^/]?\w+\}\}/);

			// No `with:` or `secrets:` followed by nothing at a deeper indent.
			const lines = yaml.split('\n').filter((line) => line.trim());
			const emptyBlocks = lines.filter((line, i) => {
				if (!/^\s*(with|secrets):$/.test(line)) {
					return false;
				}
				const indent = line.length - line.trimStart().length;
				const next = lines[i + 1] || '';
				return next.length - next.trimStart().length <= indent;
			});
			expect(emptyBlocks).toEqual([]);

			const calls = readCalls(yaml);
			expect(calls.length).toBeGreaterThan(0);

			for (const call of calls) {
				const match = call.uses.match(USES_RE);
				expect(match).not.toBeNull();
				const [, workflow, ref] = match;
				expect(ref).toBe('v1');

				const contract = CONTRACTS[workflow];
				expect(contract).toBeDefined();

				const unknownInputs = call.with.filter(
					(key) => !(key in contract.inputs)
				);
				const unknownSecrets = call.secrets.filter(
					(key) => !(key in contract.secrets)
				);
				const missingInputs = Object.keys(contract.inputs).filter(
					(key) =>
						contract.inputs[key].required &&
						!call.with.includes(key)
				);
				const missingSecrets = Object.keys(contract.secrets).filter(
					(key) =>
						contract.secrets[key].required &&
						!call.secrets.includes(key)
				);
				expect({
					workflow,
					unknownInputs,
					unknownSecrets,
					missingInputs,
					missingSecrets,
				}).toEqual({
					workflow,
					unknownInputs: [],
					unknownSecrets: [],
					missingInputs: [],
					missingSecrets: [],
				});
			}
		}
	});

	it('leaves node-version out by default and sets it when node_version is given', async () => {
		for (const scaffold of CI_SCAFFOLDS.filter((s) => s.hasNodeVersion)) {
			const [byDefault] = await renderAll(scaffold.id, scaffold.required);
			expect(byDefault).not.toContain('node-version:');

			const [pinned] = await renderAll(scaffold.id, {
				...scaffold.required,
				node_version: '24',
			});
			expect(pinned).toContain('node-version: "24"');
		}
	});
});

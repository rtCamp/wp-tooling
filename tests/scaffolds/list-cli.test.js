/**
 * `wp-tooling list` paths the main suite does not reach: the space-separated
 * flag forms, argument errors, the empty human table, and a registry that
 * fails to load (plain and --json error output).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { runCli, parseArgs } = require('../../src/scaffolds/list');

const tempDirs = [];
let stdout;
let stderr;

function makeProject() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-list-cli-'));
	tempDirs.push(dir);
	return dir;
}

// A project whose bin/scaffolds holds a manifest that fails validation, so the
// registry scan throws EBADSCAFFOLD.
function projectWithBrokenScaffold() {
	const dir = makeProject();
	const scaffold = path.join(dir, 'bin', 'scaffolds', 'broken');
	fs.mkdirSync(scaffold, { recursive: true });
	fs.writeFileSync(
		path.join(scaffold, 'scaffold.json'),
		JSON.stringify({ slug: 'broken' }),
		'utf8'
	);
	return dir;
}

beforeEach(() => {
	stdout = [];
	stderr = [];
	jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		stdout.push(String(chunk));
		return true;
	});
	jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
		stderr.push(String(chunk));
		return true;
	});
});

afterEach(() => {
	jest.restoreAllMocks();
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('parses the space-separated forms of every value flag', () => {
	expect(
		parseArgs([
			'--cwd',
			'/tmp/x',
			'--category',
			'wp',
			'--origin',
			'default',
			'--cache-dir',
			'/tmp/c',
			'--refresh',
		])
	).toMatchObject({
		cwd: '/tmp/x',
		category: 'wp',
		origin: 'default',
		cacheDir: '/tmp/c',
		refresh: true,
	});
	expect(parseArgs(['--cache-dir=/tmp/d']).cacheDir).toBe('/tmp/d');
});

test('an unexpected argument exits 1 and prints the usage', async () => {
	expect(await runCli(['--wat'])).toBe(1);
	expect(stderr.join('')).toMatch(/Unexpected argument: --wat/);
	expect(stdout.join('')).toMatch(/Usage/);
});

test('a filter that matches nothing says so in the human table', async () => {
	const dir = makeProject();
	expect(await runCli(['--category', 'no-such-category', '--cwd', dir])).toBe(
		0
	);
	expect(stdout.join('')).toMatch(/No scaffolds match the given filters\./);
});

test('a registry that fails to load exits 1 with the error', async () => {
	const dir = projectWithBrokenScaffold();
	expect(await runCli(['--cwd', dir])).toBe(1);
	expect(stderr.join('')).toMatch(/^Error: /);
});

test('with --json the load error is one JSON object on stderr', async () => {
	const dir = projectWithBrokenScaffold();
	expect(await runCli(['--json', '--cwd', dir])).toBe(1);
	expect(JSON.parse(stderr.join('').trim())).toMatchObject({
		code: 'EBADSCAFFOLD',
	});
});

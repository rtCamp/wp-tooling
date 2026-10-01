/**
 * `wp-tooling features --enable` when npm runs and fails: the feature stays
 * enabled, the warning carries npm's stderr, and the retry commands put
 * runtime deps in `dependencies` and dev deps in `devDependencies`.
 *
 * Own file so child_process can be mocked before features.js captures
 * execFileSync.
 */

'use strict';

jest.mock('child_process', () => ({
	...jest.requireActual('child_process'),
	execFileSync: jest.fn(),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');

const { execFileSync } = require('child_process');
const { runCli } = require('../../src/scaffolds/features');

const tempDirs = [];
let stdout;

function projectWithFeature() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-fi-'));
	tempDirs.push(dir);
	const scaffold = path.join(dir, 'bin', 'scaffolds', 'setup', 'charts');
	fs.mkdirSync(path.join(scaffold, 'templates'), { recursive: true });
	fs.writeFileSync(path.join(scaffold, 'templates', 'c.js'), 'x\n', 'utf8');
	fs.writeFileSync(
		path.join(scaffold, 'scaffold.json'),
		JSON.stringify({
			slug: 'charts',
			category: 'setup',
			name: 'Charts',
			description: 'Charting library.',
			source: 'template',
			files: [{ src: 'templates/c.js', dest: 'charts.js', raw: true }],
			feature: { config_key: 'charts' },
			npm_dependencies: { 'chart-runtime': '^2.0.0' },
			npm_dev_dependencies: { 'chart-types': '^1.0.0' },
		}),
		'utf8'
	);
	return dir;
}

beforeEach(() => {
	stdout = [];
	jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
		stdout.push(String(chunk));
		return true;
	});
	jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
	execFileSync.mockReset();
});

afterEach(() => {
	jest.restoreAllMocks();
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('a failed install keeps the feature enabled and prints correct retry commands', async () => {
	const dir = projectWithFeature();
	const err = new Error('Command failed: npm install');
	err.stderr = 'npm ERR! code E404\nnpm ERR! 404 Not Found - chart-runtime';
	execFileSync.mockImplementation(() => {
		throw err;
	});

	expect(await runCli(['--enable', 'charts', '--cwd', dir])).toBe(0);

	const out = stdout.join('');
	expect(out).toMatch(/enabled: charts/);
	expect(out).toMatch(/! enabled, but npm install failed:/);
	expect(out).toMatch(/404 Not Found - chart-runtime/);
	expect(out).toMatch(/\n {4}npm install chart-runtime@\^2\.0\.0\n/);
	expect(out).toMatch(/\n {4}npm install --save-dev chart-types@\^1\.0\.0\n/);
	expect(out).not.toMatch(/--save-dev chart-runtime/);
	expect(fs.existsSync(path.join(dir, 'charts.js'))).toBe(true);
});

test('a successful install lists what it installed', async () => {
	const dir = projectWithFeature();
	execFileSync.mockImplementation(() => Buffer.from(''));

	expect(await runCli(['--enable', 'charts', '--cwd', dir])).toBe(0);

	expect(execFileSync).toHaveBeenCalledWith(
		'npm',
		['install', '--save', 'chart-runtime@^2.0.0'],
		expect.objectContaining({ cwd: path.resolve(dir) })
	);
	expect(execFileSync).toHaveBeenCalledWith(
		'npm',
		['install', '--save-dev', 'chart-types@^1.0.0'],
		expect.objectContaining({ cwd: path.resolve(dir) })
	);
	const out = stdout.join('');
	expect(out).toMatch(/installed chart-runtime@\^2\.0\.0/);
	expect(out).toMatch(/installed chart-types@\^1\.0\.0/);
});

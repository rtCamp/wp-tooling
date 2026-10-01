/**
 * `wp-tooling features` end to end: the CLI and the programmatic entry point
 * (theme-elementary's init embeds runFeatures) against the bundled Tailwind
 * feature, in throwaway projects. npm is never run (`--no-install` or
 * `install: false`); the interactive flow runs against a mocked TTY kit.
 */

'use strict';

jest.mock('../../src/ui', () => ({
	confirm: jest.fn(),
	spinner: jest.fn(),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');

const ui = require('../../src/ui');
const { runCli, runFeatures } = require('../../src/scaffolds/features');

const tempDirs = [];
let stdout;
let stderr;

function makeProject({ packageJson = true } = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-features-'));
	tempDirs.push(dir);
	if (packageJson) {
		fs.writeFileSync(
			path.join(dir, 'package.json'),
			JSON.stringify({ name: 'demo', devDependencies: {} }, null, '\t') +
				'\n',
			'utf8'
		);
	}
	return dir;
}

function readConfig(dir) {
	return JSON.parse(
		fs.readFileSync(path.join(dir, '.wp-tooling.json'), 'utf8')
	);
}

// The developer-owned Tailwind entry the feature asks before deleting.
function writeEntryCss(dir) {
	const css = path.join(dir, 'src', 'css', 'frontend', 'tailwind.css');
	fs.mkdirSync(path.dirname(css), { recursive: true });
	fs.writeFileSync(css, '@import "tailwindcss";\n', 'utf8');
	return css;
}

function lastJson(chunks) {
	return JSON.parse(chunks.join('').trim().split('\n').pop());
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
	ui.confirm.mockReset();
	ui.spinner.mockReset();
	ui.spinner.mockImplementation(() => ({
		start: jest.fn(),
		update: jest.fn(),
		succeed: jest.fn(),
		fail: jest.fn(),
	}));
});

afterEach(() => {
	jest.restoreAllMocks();
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe('runCli: help and argument errors', () => {
	test('--help prints usage and exits 0', async () => {
		expect(await runCli(['--help'])).toBe(0);
		expect(stdout.join('')).toMatch(/Usage: wp-tooling features/);
	});

	test('an unknown argument exits 1 with the usage', async () => {
		expect(await runCli(['--nope'])).toBe(1);
		expect(stderr.join('')).toMatch(/Unexpected argument: --nope/);
		expect(stdout.join('')).toMatch(/Usage: wp-tooling features/);
	});

	test('a flag missing its value exits 1 instead of swallowing the next flag', async () => {
		expect(await runCli(['--cwd', '--json'])).toBe(1);
		expect(stderr.join('')).toMatch(/--cwd/);
	});
});

describe('runCli: status', () => {
	test('--json lists the bundled Tailwind feature as off', async () => {
		const dir = makeProject();
		expect(await runCli(['--json', '--cwd', dir])).toBe(0);
		const { features } = lastJson(stdout);
		const tailwind = features.find((f) => f.id === 'setup/tailwind');
		expect(tailwind).toMatchObject({
			slug: 'tailwind',
			configKey: 'tailwind',
			enabled: false,
		});
	});

	test('--non-interactive prints a checklist', async () => {
		const dir = makeProject();
		expect(await runCli(['--non-interactive', `--cwd=${dir}`])).toBe(0);
		const out = stdout.join('');
		expect(out).toMatch(/Features \(\d+\):/);
		expect(out).toMatch(/\[ \] setup\/tailwind/);
	});
});

describe('runCli: enable and disable', () => {
	test('--enable --no-install --json writes files, sets the flag and reports deps', async () => {
		const dir = makeProject();
		const code = await runCli([
			'--enable',
			'tailwind',
			'--no-install',
			'--json',
			'--cwd',
			dir,
		]);
		expect(code).toBe(0);
		const { changes } = lastJson(stdout);
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({
			id: 'tailwind',
			action: 'enabled',
			installed: false,
			recorded: [],
		});
		expect(changes[0].wrote).toContain('postcss.config.js');
		expect(changes[0].install.npmDev).toHaveProperty('tailwindcss');
		expect(fs.existsSync(path.join(dir, 'postcss.config.js'))).toBe(true);
		expect(readConfig(dir).features.tailwind).toBe(true);
		// Plain --no-install reports only: package.json is untouched.
		expect(
			JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
				.devDependencies
		).toEqual({});
	});

	test('the human report suggests the install commands when nothing was installed', async () => {
		const dir = makeProject();
		await runCli(['--enable=tailwind', '--no-install', '--cwd', dir]);
		const out = stdout.join('');
		expect(out).toMatch(/enabled: tailwind\n/);
		expect(out).toMatch(/\+ postcss\.config\.js/);
		expect(out).toMatch(/npm install --save-dev tailwindcss@/);
		expect(out).toMatch(/Done\./);
	});

	test('--record-deps records the deps in package.json and says so', async () => {
		const dir = makeProject();
		await runCli([
			'--enable',
			'tailwind',
			'--no-install',
			'--record-deps',
			'--cwd',
			dir,
		]);
		const pkg = JSON.parse(
			fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
		);
		expect(Object.keys(pkg.devDependencies)).toEqual(
			expect.arrayContaining(['tailwindcss', '@tailwindcss/postcss'])
		);
		const out = stdout.join('');
		expect(out).toMatch(/recorded tailwindcss@.* in package\.json/);
		expect(out).toMatch(/run `npm install` to install the recorded deps/);
	});

	test('--dry-run reports the change without writing anything', async () => {
		const dir = makeProject();
		await runCli([
			'--enable',
			'tailwind',
			'--dry-run',
			'--no-install',
			'--cwd',
			dir,
		]);
		expect(stdout.join('')).toMatch(/enabled: tailwind \(dry run\)/);
		expect(fs.existsSync(path.join(dir, 'postcss.config.js'))).toBe(false);
		expect(fs.existsSync(path.join(dir, '.wp-tooling.json'))).toBe(false);
	});

	test('--disable without --force keeps the developer-editable entry CSS', async () => {
		const dir = makeProject();
		await runCli(['--enable', 'tailwind', '--no-install', '--cwd', dir]);
		const css = writeEntryCss(dir);
		stdout.length = 0;

		expect(
			await runCli(['--disable', 'setup/tailwind', '--cwd', dir])
		).toBe(0);

		const out = stdout.join('');
		expect(out).toMatch(/disabled: setup\/tailwind/);
		expect(out).toMatch(/- postcss\.config\.js/);
		expect(out).toMatch(/= kept .*tailwind\.css/);
		expect(fs.existsSync(path.join(dir, 'postcss.config.js'))).toBe(false);
		expect(fs.existsSync(css)).toBe(true);
		expect(readConfig(dir).features.tailwind).toBeFalsy();
	});

	test('--disable --force also removes the developer-editable files', async () => {
		const dir = makeProject();
		await runCli(['--enable', 'tailwind', '--no-install', '--cwd', dir]);
		const css = writeEntryCss(dir);
		stdout.length = 0;

		await runCli([
			'--disable',
			'tailwind',
			'--force',
			'--json',
			'--cwd',
			dir,
		]);

		const { changes } = lastJson(stdout);
		expect(changes[0].action).toBe('disabled');
		expect(changes[0].kept).toEqual([]);
		expect(changes[0].removed.join(' ')).toMatch(/tailwind\.css/);
		expect(fs.existsSync(css)).toBe(false);
	});

	test('an unknown feature id fails with ENOTFEATURE as JSON on stderr', async () => {
		const dir = makeProject();
		expect(
			await runCli([
				'--enable',
				'no-such-feature',
				'--json',
				'--cwd',
				dir,
			])
		).toBe(1);
		expect(JSON.parse(stderr.join('').trim())).toMatchObject({
			code: 'ENOTFEATURE',
		});
	});

	test('an unknown feature id fails with a plain message without --json', async () => {
		const dir = makeProject();
		expect(
			await runCli(['--disable', 'no-such-feature', '--cwd', dir])
		).toBe(1);
		expect(stderr.join('')).toMatch(
			/Error: No toggleable feature: no-such-feature/
		);
	});
});

describe('runCli: interactive', () => {
	test('applies a change the developer confirms, under a spinner', async () => {
		const dir = makeProject();
		ui.confirm.mockImplementation(async ({ message }) =>
			/Tailwind/.test(message)
		);

		expect(await runCli(['--no-install', '--cwd', dir])).toBe(0);

		expect(ui.confirm).toHaveBeenCalledWith(
			expect.objectContaining({ defaultValue: false })
		);
		const spin = ui.spinner.mock.results[0].value;
		expect(spin.start).toHaveBeenCalled();
		expect(spin.succeed).toHaveBeenCalledWith('enabled setup/tailwind');
		expect(readConfig(dir).features.tailwind).toBe(true);
	});

	test('says "No changes." when every answer keeps the current state', async () => {
		const dir = makeProject();
		ui.confirm.mockImplementation(async ({ defaultValue }) => defaultValue);

		expect(await runCli(['--cwd', dir])).toBe(0);
		expect(stdout.join('')).toMatch(/No changes\./);
		expect(ui.spinner).not.toHaveBeenCalled();
	});

	test('asks before deleting a developer-editable file on disable', async () => {
		const dir = makeProject();
		await runCli(['--enable', 'tailwind', '--no-install', '--cwd', dir]);
		const css = writeEntryCss(dir);
		const asked = [];
		ui.confirm.mockImplementation(async ({ message, defaultValue }) => {
			asked.push(message);
			if (/Delete developer-editable file/.test(message)) {
				return true;
			}
			// Flip Tailwind off; keep anything else as it is.
			return /Tailwind/.test(message) ? false : defaultValue;
		});

		expect(await runCli(['--cwd', dir])).toBe(0);

		expect(asked.some((m) => /currently on/.test(m))).toBe(true);
		expect(
			asked.some((m) => /Delete developer-editable file/.test(m))
		).toBe(true);
		expect(fs.existsSync(css)).toBe(false);
		expect(readConfig(dir).features.tailwind).toBeFalsy();
	});

	test('a cancelled prompt propagates so the dispatcher can exit 130', async () => {
		const dir = makeProject();
		const cancelled = new Error('cancelled');
		cancelled.name = 'CancelledError';
		ui.confirm.mockRejectedValue(cancelled);

		await expect(runCli(['--cwd', dir])).rejects.toBe(cancelled);
	});

	test('a failing change marks the spinner failed and exits 1', async () => {
		const dir = makeProject();
		// A file where a directory has to go makes the gitignore write fail.
		fs.mkdirSync(path.join(dir, '.gitignore'));
		ui.confirm.mockImplementation(async ({ message }) =>
			/Tailwind/.test(message)
		);

		expect(await runCli(['--no-install', '--cwd', dir])).toBe(1);

		const spin = ui.spinner.mock.results[0].value;
		expect(spin.fail).toHaveBeenCalledWith(
			'Failed to enable setup/tailwind'
		);
		expect(stderr.join('')).toMatch(/^Error: /);
	});
});

describe('runFeatures (programmatic, as embedded by the theme init)', () => {
	test('enable implies non-interactive and never prompts', async () => {
		const dir = makeProject();
		expect(
			await runFeatures({
				cwd: dir,
				enable: ['tailwind'],
				install: false,
			})
		).toBe(0);
		expect(ui.confirm).not.toHaveBeenCalled();
		expect(readConfig(dir).features.tailwind).toBe(true);
	});

	test('install:false with record:true records deps, as init does inside npm install', async () => {
		const dir = makeProject();
		await runFeatures({
			cwd: dir,
			enable: ['tailwind'],
			install: false,
			record: true,
		});
		const pkg = JSON.parse(
			fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
		);
		expect(pkg.devDependencies).toHaveProperty('tailwindcss');
	});

	test('with no changes requested it prints the status', async () => {
		const dir = makeProject({ packageJson: false });
		expect(await runFeatures({ cwd: dir, nonInteractive: true })).toBe(0);
		expect(stdout.join('')).toMatch(/setup\/tailwind/);
	});
});

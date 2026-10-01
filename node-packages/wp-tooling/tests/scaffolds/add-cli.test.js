/**
 * `wp-tooling add`: the human report sections the existing suite does not
 * reach (composer installs, secrets, wiring, scaffolded tests, warnings,
 * skipped files) and the interactive wizard flow (prompting for missing
 * inputs, confirm, spinner, cancel, dry run, unknown id).
 *
 * The real Wizard runs; only the prompts and the spinner are stubbed.
 */

'use strict';

jest.mock('../../src/ui', () => {
	const actual = jest.requireActual('../../src/ui');
	return {
		...actual,
		confirm: jest.fn(),
		spinner: jest.fn(),
	};
});
jest.mock('../../src/scaffolds/prompt-inputs', () => ({
	promptMissingInputs: jest.fn(),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');

const ui = require('../../src/ui');
const { promptMissingInputs } = require('../../src/scaffolds/prompt-inputs');
const { runCli } = require('../../src/scaffolds/add');

const tempDirs = [];
let stdout;
let stderr;

function makeProject() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-add-cli-'));
	tempDirs.push(dir);
	fs.writeFileSync(
		path.join(dir, 'composer.json'),
		JSON.stringify({
			name: 'acme/shop',
			autoload: { 'psr-4': { 'Acme\\Shop\\': 'includes/' } },
		}),
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
	ui.confirm.mockReset();
	ui.spinner.mockReset();
	ui.spinner.mockImplementation(() => ({
		start: jest.fn(),
		update: jest.fn(),
		succeed: jest.fn(),
		fail: jest.fn(),
	}));
	promptMissingInputs.mockReset();
});

afterEach(() => {
	jest.restoreAllMocks();
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe('human report (non-interactive)', () => {
	test('lists the written files, composer install, wiring and scaffolded tests', async () => {
		const dir = makeProject();
		const code = await runCli([
			'wp/cpt',
			'--non-interactive',
			'--slug',
			'product',
			'--singular',
			'Product',
			'--plural',
			'Products',
			'--cwd',
			dir,
		]);

		expect(code).toBe(0);
		const out = stdout.join('');
		expect(out).toMatch(/^Scaffold: wp\/cpt, kind: template/);
		expect(out).toMatch(
			/Engine wrote:\n {2}\+ includes\/PostTypes\/Product\.php/
		);
		expect(out).toMatch(
			/Install \(composer\):\n {4}composer require rtcamp\//
		);
		expect(out).toMatch(/Wiring suggestions/);
		expect(out).toMatch(/File: includes\/Modules\/PostTypes\.php/);
		expect(out).toMatch(
			/Insert near anchor: \/\/ scaffold:wp\/cpt:classes/
		);
		expect(out).toMatch(
			/Tests scaffolded:\n {2}\+ tests\/PostTypes\/ProductTest\.php \(phpunit/
		);
		expect(out.trim().endsWith('Done.')).toBe(true);
	});

	test('reports files that already existed as skipped, with a warning', async () => {
		const dir = makeProject();
		const args = [
			'wp/cpt',
			'--non-interactive',
			'--slug',
			'product',
			'--singular',
			'Product',
			'--plural',
			'Products',
			'--cwd',
			dir,
		];
		await runCli(args);
		stdout.length = 0;

		expect(await runCli(args)).toBe(0);

		const out = stdout.join('');
		expect(out).toMatch(/Engine wrote: \(no files\)/);
		expect(out).toMatch(
			/Engine skipped \(file already existed\):\n {2}= includes\/PostTypes\/Product\.php/
		);
		expect(out).toMatch(
			/Warnings:\n {2}! file already exists, not overwritten/
		);
	});

	test('warns about a supplied input the scaffold does not declare', async () => {
		const dir = makeProject();
		await runCli([
			'utility/logger',
			'--non-interactive',
			'--dry-run',
			'--namspace',
			'Typo',
			'--cwd',
			dir,
		]);
		const out = stdout.join('');
		expect(out).toMatch(/\(dry run\), kind: package/);
		expect(out).toMatch(/! unknown input "namspace" supplied/);
	});

	test('prints the secrets the developer has to set', async () => {
		const dir = makeProject();
		await runCli([
			'ci/cd-wporg',
			'--non-interactive',
			'--dry-run',
			'--plugin-slug',
			'acme-shop',
			'--cwd',
			dir,
		]);
		const out = stdout.join('');
		expect(out).toMatch(
			/Set secrets \(run these yourself; I never set secrets\):/
		);
		expect(out).toMatch(
			/gh secret set WPORG_USERNAME\n {4}# WordPress\.org SVN username/
		);
		expect(out).toMatch(/gh secret set WPORG_PASSWORD/);
	});

	test('names the available scaffolds for an unknown id', async () => {
		const dir = makeProject();
		expect(
			await runCli(['wp/nope', '--non-interactive', '--cwd', dir])
		).toBe(1);
		const err = stderr.join('');
		expect(err).toMatch(/Error: No scaffold registered for slug: wp\/nope/);
		expect(err).toMatch(/Available scaffolds:\n {2}\S+/);
	});
});

describe('interactive wizard', () => {
	test('prompts for the missing inputs, confirms, then scaffolds under a spinner', async () => {
		const dir = makeProject();
		promptMissingInputs.mockImplementation(
			async ({ supplied, missing }) => {
				expect(missing).toEqual(
					expect.arrayContaining(['slug', 'singular', 'plural'])
				);
				return {
					...supplied,
					slug: 'event',
					singular: 'Event',
					plural: 'Events',
				};
			}
		);
		ui.confirm.mockResolvedValue(true);

		expect(await runCli(['wp/cpt', '--cwd', dir])).toBe(0);

		expect(ui.confirm).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringMatching(
					/Scaffold wp\/cpt will create \d+ file/
				),
			})
		);
		const spin = ui.spinner.mock.results[0].value;
		expect(spin.succeed).toHaveBeenCalledWith('Scaffolded wp/cpt');
		expect(
			fs.existsSync(path.join(dir, 'includes', 'PostTypes', 'Event.php'))
		).toBe(true);
		expect(stdout.join('')).toMatch(/\+ includes\/PostTypes\/Event\.php/);
	});

	test('declining the confirm cancels without writing', async () => {
		const dir = makeProject();
		ui.confirm.mockResolvedValue(false);

		await expect(
			runCli([
				'wp/cpt',
				'--slug',
				'event',
				'--singular',
				'Event',
				'--plural',
				'Events',
				'--cwd',
				dir,
			])
		).rejects.toMatchObject({ name: 'CancelledError' });

		expect(fs.existsSync(path.join(dir, 'includes'))).toBe(false);
		expect(ui.spinner).not.toHaveBeenCalled();
	});

	test('--dry-run skips the confirm and writes nothing', async () => {
		const dir = makeProject();

		expect(
			await runCli([
				'wp/cpt',
				'--dry-run',
				'--slug=event',
				'--singular=Event',
				'--plural=Events',
				`--cwd=${dir}`,
			])
		).toBe(0);

		expect(ui.confirm).not.toHaveBeenCalled();
		expect(fs.existsSync(path.join(dir, 'includes'))).toBe(false);
		expect(stdout.join('')).toMatch(/Scaffold: wp\/cpt \(dry run\)/);
	});

	test('a failed write marks the spinner failed and exits 1', async () => {
		const dir = makeProject();
		// A file where the PostTypes directory has to go.
		fs.mkdirSync(path.join(dir, 'includes'), { recursive: true });
		fs.writeFileSync(path.join(dir, 'includes', 'PostTypes'), 'x', 'utf8');
		ui.confirm.mockResolvedValue(true);

		const code = await runCli([
			'wp/cpt',
			'--slug',
			'event',
			'--singular',
			'Event',
			'--plural',
			'Events',
			'--cwd',
			dir,
		]);

		expect(code).toBe(1);
		const spin = ui.spinner.mock.results[0].value;
		expect(spin.fail).toHaveBeenCalledWith('Failed to scaffold wp/cpt');
		expect(stderr.join('')).toMatch(/^Error: /);
	});

	test('an unknown id fails in the discover step', async () => {
		const dir = makeProject();
		expect(await runCli(['wp/nope', '--cwd', dir])).toBe(1);
		expect(stderr.join('')).toMatch(
			/No scaffold registered for slug: wp\/nope/
		);
		expect(promptMissingInputs).not.toHaveBeenCalled();
	});
});

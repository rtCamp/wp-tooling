/**
 * Tests for installDeps: it must run npm WITHOUT a shell (execFileSync, so a
 * hostile manifest package name can't inject a command) and, on a non-zero
 * exit, raise EINSTALLFAIL carrying npm's stderr tail rather than an opaque
 * "Command failed".
 *
 * Lives in its own file so child_process can be mocked before features.js
 * captures execFileSync.
 */

'use strict';

jest.mock('child_process');

const fs = require('fs');
const os = require('os');
const path = require('path');

const { execFileSync } = require('child_process');
const { ScaffoldRegistry } = require('../../src/scaffolds/registry');
const { applyChange } = require('../../src/scaffolds/features');

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-install-'));
}

async function freshRegistry(npmDev = { tailwindcss: '^4' }) {
	const projectDir = makeTmpDir();
	const dir = path.join(projectDir, 'setup', 'tailwind');
	fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'templates', 'p.js'), 'x\n', 'utf8');
	fs.writeFileSync(
		path.join(dir, 'scaffold.json'),
		JSON.stringify({
			slug: 'tailwind',
			category: 'setup',
			name: 'Tailwind CSS',
			description: 'd',
			source: 'template',
			files: [
				{ src: 'templates/p.js', dest: 'postcss.config.js', raw: true },
			],
			feature: { config_key: 'tailwind' },
			npm_dev_dependencies: npmDev,
		}),
		'utf8'
	);
	const r = new ScaffoldRegistry({ projectDir });
	await r.scan();
	return r;
}

describe('installDeps', () => {
	it('runs npm without a shell, passing each spec as a literal argv element', async () => {
		// A hostile (e.g. remote) manifest name must never reach a shell.
		const registry = await freshRegistry({ 'evil; touch /tmp/pwned': '1' });
		execFileSync.mockImplementation(() => Buffer.from(''));
		const summary = await applyChange(
			registry,
			{ id: 'setup/tailwind', target: true },
			{ cwd: makeTmpDir(), dryRun: false, install: true }
		);
		expect(summary.installed).toBe(true);
		expect(execFileSync).toHaveBeenCalledWith(
			'npm',
			['install', '--save-dev', 'evil; touch /tmp/pwned@1'],
			expect.objectContaining({ stdio: 'pipe' })
		);
	});

	it('raises EINSTALLFAIL with npm stderr attached on failure', async () => {
		const registry = await freshRegistry();
		const err = new Error('Command failed: npm install');
		err.stderr =
			'npm ERR! code E404\nnpm ERR! 404 Not Found - tailwindcss@^4';
		execFileSync.mockImplementation(() => {
			throw err;
		});
		const summary = await applyChange(
			registry,
			{ id: 'setup/tailwind', target: true },
			{ cwd: makeTmpDir(), dryRun: false, install: true }
		);
		// The enable succeeded and is reported; the install failure is
		// surfaced on the summary, not thrown away.
		expect(summary.action).toBe('enabled');
		expect(summary.installed).toBe(false);
		expect(summary.installError).toContain('npm ERR! 404 Not Found');
	});
});

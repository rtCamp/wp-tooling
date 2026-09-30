'use strict';
jest.mock('child_process', () => ({ execFileSync: jest.fn() }));
jest.mock('../../src/init/git', () => ({
	initRepo: jest.fn(),
	installGitHooks: jest.fn(),
	commitAll: jest.fn(),
}));

const { execFileSync } = require('child_process');
const git = require('../../src/init/git');
const ui = require('../../src/ui');
const fs = require('fs');
const path = require('path');
const { run } = require('../../src/init');
const { makeRoot, touch, capture, snapshot } = require('./_helpers');

const config = {
	kind: 'theme',
	source: { name: 'Starter Theme' },
	features: [
		{ key: 'dev-tools', label: 'Developer tools', detect: () => false },
	],
	examples: {
		groups: [
			{ key: 'demo', label: 'Demo', remove: ['demo.txt'], strip: [] },
		],
	},
	steps: {},
};

describe('setup validates before mutation', () => {
	let root;
	beforeEach(() => {
		root = makeRoot();
		touch(root, 'starter-theme.txt', 'Starter Theme starter-theme');
		touch(root, 'demo.txt', 'demo');
		process.exitCode = undefined;
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
		process.exitCode = undefined;
	});

	test.each([
		['--features=typo'],
		['--enable=typo'],
		['--disable=typo'],
		['--remove-examples=typo'],
		['--features=', '--enable=dev-tools'],
		['--keep-examples', '--remove-examples=demo'],
		['--version=invalid'],
		['--version='],
		['--name=123'],
	])('rejects %j without changing files', async (...flags) => {
		const before = snapshot(root);
		await capture(async () => {
			await expect(
				run(config, {
					root,
					argv: ['--yes', '--name=Acme Blog', ...flags],
				})
			).resolves.toBeUndefined();
		});
		expect(snapshot(root)).toEqual(before);
		expect(process.exitCode).toBe(1);
	});
});

describe('setup sequencing and reinitialization', () => {
	let root;
	beforeEach(() => {
		root = makeRoot();
		touch(root, 'starter-theme.txt', 'Starter Theme starter-theme');
		process.exitCode = undefined;
	});
	afterEach(() => {
		jest.restoreAllMocks();
		fs.rmSync(root, { recursive: true, force: true });
		process.exitCode = undefined;
	});

	test('an unreadable project directory aborts before identity writes', async () => {
		touch(root, 'inc/Module.php', 'Starter Theme');
		const before = snapshot(root);
		const readDirectory = fs.readdirSync;
		jest.spyOn(fs, 'readdirSync').mockImplementation((dir, ...args) => {
			if (dir === path.join(root, 'inc')) {
				throw new Error('EACCES: inc');
			}
			return readDirectory(dir, ...args);
		});
		await capture(async () => {
			await expect(
				run(config, { root, argv: ['--yes', '--name=Acme Blog'] })
			).rejects.toThrow('EACCES: inc');
		});
		expect(snapshot(root)).toEqual(before);
		expect(process.exitCode).toBe(1);
	});

	test('cancelled capability confirmation leaves the entire tree unchanged', async () => {
		jest.spyOn(ui, 'confirm')
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		const before = snapshot(root);
		await capture(() =>
			run(config, {
				root,
				argv: ['--name=Acme Blog', '--features=dev-tools'],
			})
		);
		expect(snapshot(root)).toEqual(before);
		expect(process.exitCode).toBe(130);
	});

	test('setup detection uses source identity before rename and target identity after it', async () => {
		touch(root, 'starter-theme.flag', 'enabled');
		const seen = [];
		const feature = {
			key: 'demo',
			label: 'Demo feature',
			detect(api) {
				seen.push(api.identity.slug);
				return api.exists(`${api.identity.slug}.flag`);
			},
			onEnable: jest.fn(),
			onDisable: jest.fn(),
		};
		await capture(() =>
			run(
				{ ...config, features: [feature] },
				{
					root,
					argv: ['--yes', '--name=Acme Blog'],
				}
			)
		);
		expect(seen[0]).toBe('starter-theme');
		expect(seen.slice(1)).toEqual(['acme-blog', 'acme-blog']);
		expect(feature.onEnable).not.toHaveBeenCalled();
		expect(feature.onDisable).not.toHaveBeenCalled();
		expect(
			JSON.parse(fs.readFileSync(path.join(root, '.wp-scaffold.json')))
				.features
		).toEqual({ demo: true });
	});

	test('reinit replaces the current identity and preserves unrelated metadata', async () => {
		await capture(() =>
			run(config, { root, argv: ['--yes', '--name=Acme Blog'] })
		);
		const identityPath = path.join(root, '.wp-scaffold.json');
		const identity = JSON.parse(fs.readFileSync(identityPath));
		identity.custom = { retained: true };
		fs.writeFileSync(identityPath, JSON.stringify(identity));
		await capture(() =>
			run(config, {
				root,
				argv: ['--reinit', '--yes', '--name=Cedar Blog'],
			})
		);
		expect(fs.readFileSync(path.join(root, 'cedar-blog.txt'), 'utf8')).toBe(
			'Cedar Blog cedar-blog'
		);
		expect(JSON.parse(fs.readFileSync(identityPath)).custom).toEqual({
			retained: true,
		});
	});

	test('mutating reinit refuses corrupt identity without modifying files', async () => {
		touch(root, '.wp-scaffold.json', '{broken');
		const before = snapshot(root);
		await capture(() =>
			run(config, {
				root,
				argv: ['--reinit', '--yes', '--name=Acme Blog'],
			})
		);
		expect(snapshot(root)).toEqual(before);
		expect(process.exitCode).toBe(1);
	});
});

describe('reinit example selection', () => {
	let root;
	beforeEach(() => {
		root = makeRoot();
		process.exitCode = undefined;
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
		process.exitCode = undefined;
	});

	test('keeps removed examples consumed across reinit and refuses new example choices', async () => {
		touch(root, 'demo.txt', 'example');
		const consumerConfig = config;
		await capture(() =>
			run(consumerConfig, {
				root,
				argv: ['--yes', '--name=Acme Blog', '--remove-examples=demo'],
			})
		);
		await capture(() =>
			run(consumerConfig, {
				root,
				argv: ['--yes', '--reinit', '--name=Cedar Blog'],
			})
		);
		expect(
			JSON.parse(fs.readFileSync(path.join(root, '.wp-scaffold.json')))
				.examples.removed
		).toEqual(['demo']);
		expect(fs.existsSync(path.join(root, 'demo.txt'))).toBe(false);
		const before = snapshot(root);
		await capture(async () => {
			await expect(
				run(consumerConfig, {
					root,
					argv: [
						'--yes',
						'--reinit',
						'--name=Cedar Blog',
						'--keep-examples',
					],
				})
			).resolves.toBeUndefined();
		});
		expect(snapshot(root)).toEqual(before);
		expect(process.exitCode).toBe(1);
	});
});

describe('setup step failures and optional steps', () => {
	let root;
	const stepConfig = {
		kind: 'theme',
		source: { name: 'Starter Theme' },
		cleanup: { targets: ['keep.txt'] },
		steps: { cleanup: true, git: true, hooks: true, composer: true },
	};
	beforeEach(() => {
		root = makeRoot();
		touch(root, 'keep.txt', 'Starter Theme');
		process.exitCode = undefined;
		jest.spyOn(ui, 'confirm').mockResolvedValue(true);
		git.initRepo.mockReturnValue(true);
		git.installGitHooks.mockResolvedValue(true);
		git.commitAll.mockReturnValue(true);
	});
	afterEach(() => {
		jest.restoreAllMocks();
		jest.clearAllMocks();
		fs.rmSync(root, { recursive: true, force: true });
		process.exitCode = undefined;
	});

	test('Composer failure stops cleanup and Git and reports partial setup', async () => {
		touch(root, 'composer.json', '{}');
		execFileSync.mockImplementationOnce(() => {
			throw new Error('Composer failed');
		});
		const output = await capture(async () => {
			await expect(
				run(stepConfig, { root, argv: ['--name=Acme Blog'] })
			).rejects.toThrow('Composer failed');
		});
		expect(fs.existsSync(path.join(root, 'keep.txt'))).toBe(true);
		expect(git.initRepo).not.toHaveBeenCalled();
		expect(output.stdout + output.stderr).toContain(
			'Some changes may remain'
		);
		expect(output.stdout).not.toContain('Your new theme is ready');
		expect(process.exitCode).toBe(1);
	});

	test.each(['initRepo', 'installGitHooks', 'commitAll'])(
		'%s failure stops setup',
		async (operation) => {
			git[operation].mockImplementation(() => {
				throw new Error(`${operation} failed`);
			});
			const output = await capture(async () => {
				await expect(
					run(stepConfig, { root, argv: ['--name=Acme Blog'] })
				).rejects.toThrow(/failed/);
			});
			expect(process.exitCode).toBe(1);
			expect(output.stdout + output.stderr).toContain(
				'Project setup completed'
			);
			expect(output.stdout + output.stderr).not.toContain(
				'restore your starter backup'
			);
			expect(
				JSON.parse(
					fs.readFileSync(path.join(root, '.wp-scaffold.json'))
				).name
			).toBe('Acme Blog');
			expect(fs.existsSync(path.join(root, 'keep.txt'))).toBe(false);
		}
	);

	test('cancelling a Git prompt preserves completed project setup', async () => {
		jest.spyOn(ui, 'confirm').mockImplementation(async ({ message }) => {
			if (message.startsWith('Initialize a git')) {
				throw new ui.CancelledError();
			}
			return true;
		});
		const output = await capture(() =>
			run(stepConfig, { root, argv: ['--name=Acme Blog'] })
		);
		expect(process.exitCode).toBe(130);
		expect(output.stdout + output.stderr).toContain(
			'Git setup was cancelled'
		);
		expect(output.stdout + output.stderr).not.toContain(
			'restore your starter backup'
		);
		expect(git.initRepo).not.toHaveBeenCalled();
	});

	test('declining optional Git initialization succeeds without invoking Git', async () => {
		jest.spyOn(ui, 'confirm').mockImplementation(
			async ({ message }) => !message.startsWith('Initialize a git')
		);
		await capture(() =>
			run(stepConfig, { root, argv: ['--name=Acme Blog'] })
		);
		expect(git.initRepo).not.toHaveBeenCalled();
		expect(process.exitCode).toBeUndefined();
	});

	test('feature failure prevents identity persistence and cleanup', async () => {
		const feature = {
			key: 'demo',
			label: 'Demo',
			detect: () => false,
			onEnable() {
				throw new Error('hook failed');
			},
			onDisable() {},
		};
		await capture(async () => {
			await expect(
				run(
					{ ...stepConfig, features: [feature] },
					{
						root,
						argv: ['--yes', '--name=Acme Blog', '--features=demo'],
					}
				)
			).rejects.toThrow('Feature setup failed');
		});
		expect(fs.existsSync(path.join(root, 'keep.txt'))).toBe(true);
		expect(fs.existsSync(path.join(root, '.wp-scaffold.json'))).toBe(false);
		expect(git.initRepo).not.toHaveBeenCalled();
	});

	test('identity persistence failure prevents cleanup and Git', async () => {
		const originalWrite = fs.writeFileSync;
		jest.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
			if (path.basename(file) === '.wp-scaffold.json') {
				throw new Error('identity write failed');
			}
			return originalWrite(file, ...args);
		});
		await capture(async () => {
			await expect(
				run(stepConfig, { root, argv: ['--yes', '--name=Acme Blog'] })
			).rejects.toThrow('identity write failed');
		});
		expect(fs.existsSync(path.join(root, 'keep.txt'))).toBe(true);
		expect(git.initRepo).not.toHaveBeenCalled();
	});

	test('declining optional hooks still permits the already-approved Git flow', async () => {
		jest.spyOn(ui, 'confirm').mockImplementation(
			async ({ message }) => !message.startsWith('Install git hooks')
		);
		await capture(() =>
			run(stepConfig, { root, argv: ['--name=Acme Blog'] })
		);
		expect(git.initRepo).toHaveBeenCalledTimes(1);
		expect(git.installGitHooks).not.toHaveBeenCalled();
		expect(git.commitAll).toHaveBeenCalledTimes(1);
		expect(process.exitCode).toBeUndefined();
	});
});

describe('entry-point error reporting', () => {
	let root;
	beforeEach(() => {
		root = makeRoot();
		process.exitCode = undefined;
	});
	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
		process.exitCode = undefined;
		jest.restoreAllMocks();
	});
	test('manage usage errors are reported without rejecting or probing features', async () => {
		touch(root, '.wp-scaffold.json', JSON.stringify({ name: 'Acme Blog' }));
		const detect = jest.fn();
		const output = await capture(async () => {
			await expect(
				run(
					{
						...config,
						features: [
							{ key: 'demo', label: 'Feature demo', detect },
						],
					},
					{ root, argv: ['--features=typo'] }
				)
			).resolves.toBeUndefined();
		});
		expect(output.stdout + output.stderr).toMatch(/Unknown feature.*typo/);
		expect(process.exitCode).toBe(1);
		expect(detect).not.toHaveBeenCalled();
	});
	test.each(['keep.txt', null, false, ''])(
		'standalone cleanup rejects malformed targets %j before deleting files',
		async (targets) => {
			touch(root, 'keep.txt', 'keep');
			jest.spyOn(ui, 'confirm').mockResolvedValue(true);
			await capture(async () => {
				await expect(
					run(
						{ ...config, cleanup: { targets } },
						{ root, argv: ['--clean'] }
					)
				).rejects.toThrow(/Expected cleanup.targets to be an array/);
			});
			expect(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8')).toBe(
				'keep'
			);
			expect(process.exitCode).toBe(1);
		}
	);
});

describe('setup identity transaction', () => {
	let root;
	beforeEach(() => {
		root = makeRoot();
		process.exitCode = undefined;
	});
	afterEach(() => {
		jest.restoreAllMocks();
		fs.rmSync(root, { recursive: true, force: true });
		process.exitCode = undefined;
	});
	test.each(
		['replace', 'rename', 'version'].flatMap((phase) => [
			[phase, false],
			[phase, true],
		])
	)(
		'restores identity files after %s fails (reinit: %s)',
		async (phase, reinit) => {
			touch(root, 'starter-theme.txt', 'Starter Theme');
			touch(root, 'z.txt', 'Starter Theme');
			touch(root, 'package.json', '{"version":"1.0.0"}');
			if (reinit) {
				await capture(() =>
					run(config, {
						root,
						argv: ['--yes', '--name=First Project'],
					})
				);
			}
			const before = snapshot(root);
			const write = fs.writeFileSync;
			let failed = false;
			jest.spyOn(fs, 'writeFileSync').mockImplementation(
				(file, ...args) => {
					if (
						!failed &&
						(('replace' === phase &&
							path.basename(file) === 'z.txt') ||
							('version' === phase &&
								path.basename(file) === 'package.json'))
					) {
						failed = true;
						write(file, 'partial');
						throw new Error('injected failure');
					}
					return write(file, ...args);
				}
			);
			const rename = fs.renameSync;
			jest.spyOn(fs, 'renameSync').mockImplementation((...args) => {
				if (!failed && 'rename' === phase) {
					failed = true;
					throw new Error('injected failure');
				}
				return rename(...args);
			});
			await capture(async () => {
				await expect(
					run(
						{
							...config,
							versionFiles: [
								{ path: 'package.json', kind: 'json' },
							],
						},
						{
							root,
							argv: [
								'--yes',
								'--name=Acme Blog',
								...(reinit ? ['--reinit'] : []),
							],
						}
					)
				).rejects.toThrow('injected failure');
			});
			expect(snapshot(root)).toEqual(before);
		}
	);
});

describe('first-setup cleanup moves and key removals', () => {
	let root;
	const cleanupConfig = {
		kind: 'theme',
		source: { name: 'Starter Theme' },
		cleanup: {
			targets: ['CONTRIBUTING.md'],
			replace: [{ from: 'README.theme.md', to: 'README.md' }],
			unset: [{ file: 'package.json', keys: ['homepage', 'bugs'] }],
		},
		steps: { cleanup: true, git: true },
	};
	const starterReadme = '# Starter Theme starter kit\n';
	const starterPackage = `${JSON.stringify(
		{
			name: 'starter-theme',
			homepage: 'https://example.com/starter-theme',
			bugs: { url: 'https://example.com/starter-theme/issues' },
			license: 'GPL-2.0-or-later',
		},
		null,
		'\t'
	)}\n`;
	const setupPackage = `${JSON.stringify(
		{ name: 'acme-blog', license: 'GPL-2.0-or-later' },
		null,
		'\t'
	)}\n`;
	const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
	const exists = (rel) => fs.existsSync(path.join(root, rel));
	const setUp = (argv, setupConfig = cleanupConfig) =>
		capture(() => run(setupConfig, { root, argv }));

	beforeEach(() => {
		root = makeRoot();
		touch(root, 'README.md', starterReadme);
		touch(root, 'README.theme.md', '# Starter Theme\n');
		touch(root, 'CONTRIBUTING.md', 'Contribute to the starter.');
		touch(root, 'package.json', starterPackage);
		process.exitCode = undefined;
		jest.spyOn(ui, 'confirm').mockResolvedValue(true);
		git.initRepo.mockReturnValue(true);
		git.commitAll.mockReturnValue(true);
	});
	afterEach(() => {
		jest.restoreAllMocks();
		jest.clearAllMocks();
		fs.rmSync(root, { recursive: true, force: true });
		process.exitCode = undefined;
	});

	test('first setup applies the moves, key removals and targets before the initial commit', async () => {
		let committed;
		git.commitAll.mockImplementation(() => {
			committed = {
				readme: read('README.md'),
				template: exists('README.theme.md'),
				contributing: exists('CONTRIBUTING.md'),
				pkg: read('package.json'),
			};
			return true;
		});
		await setUp(['--name=Acme Blog']);
		expect(process.exitCode).toBeUndefined();
		expect(git.commitAll).toHaveBeenCalledTimes(1);
		expect(committed).toEqual({
			readme: '# Acme Blog\n',
			template: false,
			contributing: false,
			pkg: setupPackage,
		});
	});

	test('a source folder that is also a target is emptied by the moves, then deleted', async () => {
		touch(root, 'starter-docs/README.md', '# Starter Theme docs\n');
		await setUp(['--yes', '--name=Acme Blog'], {
			...cleanupConfig,
			cleanup: {
				targets: ['starter-docs'],
				replace: [{ from: 'starter-docs/README.md', to: 'README.md' }],
			},
		});
		expect(process.exitCode).toBeUndefined();
		expect(read('README.md')).toBe('# Acme Blog docs\n');
		expect(exists('starter-docs')).toBe(false);
	});

	test('reinit leaves an edited README, a new template and re-added keys alone', async () => {
		await setUp(['--yes', '--name=Acme Blog']);
		const ownPackage =
			'{\n\t"homepage": "https://example.com/our-site"\n}\n';
		touch(root, 'README.md', 'Our own README\n');
		touch(root, 'README.theme.md', '# Template\n');
		touch(root, 'package.json', ownPackage);
		await setUp(['--reinit', '--yes', '--name=Cedar Blog']);
		expect(process.exitCode).toBeUndefined();
		expect(read('README.md')).toBe('Our own README\n');
		expect(read('README.theme.md')).toBe('# Template\n');
		expect(read('package.json')).toBe(ownPackage);
	});

	test('--clean removes the targets only, even on a fresh starter', async () => {
		await setUp(['--clean']);
		expect(exists('CONTRIBUTING.md')).toBe(false);
		expect(read('README.md')).toBe(starterReadme);
		expect(exists('README.theme.md')).toBe(true);
		expect(read('package.json')).toBe(starterPackage);
	});

	test('a disabled cleanup step skips the moves and key removals', async () => {
		await setUp(['--yes', '--name=Acme Blog'], {
			...cleanupConfig,
			steps: {},
		});
		expect(exists('README.theme.md')).toBe(true);
		expect(exists('CONTRIBUTING.md')).toBe(true);
		expect(JSON.parse(read('package.json')).homepage).toBe(
			'https://example.com/acme-blog'
		);
	});

	test('a cancelled setup leaves the starter unchanged', async () => {
		ui.confirm.mockResolvedValue(false);
		const before = snapshot(root);
		await setUp(['--name=Acme Blog']);
		expect(snapshot(root)).toEqual(before);
		expect(process.exitCode).toBe(130);
	});

	test('a JSON file that fails to parse stops setup before any move and reports the partial setup', async () => {
		touch(root, 'package.json', '{ broken');
		const output = await capture(async () => {
			await expect(
				run(cleanupConfig, {
					root,
					argv: ['--yes', '--name=Acme Blog'],
				})
			).rejects.toThrow(/package\.json to be valid JSON/);
		});
		expect(process.exitCode).toBe(1);
		expect(output.stdout + output.stderr).toContain(
			'restore your starter backup'
		);
		expect(read('README.md')).toBe('# Acme Blog starter kit\n');
		expect(exists('README.theme.md')).toBe(true);
	});

	test('an invalid move is rejected before setup changes anything', async () => {
		const invalidConfig = {
			...cleanupConfig,
			cleanup: {
				...cleanupConfig.cleanup,
				replace: [{ from: 'README.theme.md', to: 'CONTRIBUTING.md' }],
			},
		};
		const before = snapshot(root);
		await capture(async () => {
			await expect(
				run(invalidConfig, {
					root,
					argv: ['--yes', '--name=Acme Blog'],
				})
			).rejects.toThrow(/outside cleanup target "CONTRIBUTING\.md"/);
		});
		expect(snapshot(root)).toEqual(before);
		expect(process.exitCode).toBe(1);
	});
});

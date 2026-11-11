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
const { makeRoot, touch, capture, snapshot, tree } = require('./_helpers');

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

	test('Composer failure undoes setup, including the vendor/ it created', async () => {
		touch(root, 'composer.json', '{}');
		const before = snapshot(root);
		const paths = tree(root);
		let seen;
		execFileSync.mockImplementationOnce(() => {
			// Cleanup has run and the marker is not written yet.
			seen = {
				target: fs.existsSync(path.join(root, 'keep.txt')),
				marker: fs.existsSync(path.join(root, '.wp-scaffold.json')),
			};
			touch(root, 'vendor/autoload.php', '<?php');
			throw new Error('Composer failed');
		});
		const output = await capture(async () => {
			await expect(
				run(stepConfig, { root, argv: ['--name=Acme Blog'] })
			).rejects.toThrow('Composer failed');
		});
		expect(seen).toEqual({ target: false, marker: false });
		expect(snapshot(root)).toEqual(before);
		expect(tree(root)).toEqual(paths);
		expect(git.initRepo).not.toHaveBeenCalled();
		expect(output.stdout + output.stderr).toContain(
			'init undid the changes it made'
		);
		expect(output.stdout + output.stderr).not.toContain('vendor/');
		expect(output.stdout).not.toContain('Your new theme is ready');
		expect(process.exitCode).toBe(1);
	});

	test('Composer failure keeps a vendor/ that already existed and says so', async () => {
		touch(root, 'composer.json', '{}');
		touch(root, 'vendor/autoload.php', 'old');
		execFileSync.mockImplementationOnce(() => {
			touch(root, 'vendor/autoload.php', 'new');
			throw new Error('Composer failed');
		});
		const output = await capture(async () => {
			await expect(
				run(stepConfig, { root, argv: ['--name=Acme Blog'] })
			).rejects.toThrow('Composer failed');
		});
		expect(
			fs.readFileSync(path.join(root, 'vendor/autoload.php'), 'utf8')
		).toBe('new');
		expect(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8')).toBe(
			'Starter Theme'
		);
		expect(fs.existsSync(path.join(root, '.wp-scaffold.json'))).toBe(false);
		expect(output.stdout + output.stderr).toContain(
			'Composer may have rewritten vendor/'
		);
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

	test('feature failure undoes setup', async () => {
		const before = snapshot(root);
		const paths = tree(root);
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
		expect(snapshot(root)).toEqual(before);
		expect(tree(root)).toEqual(paths);
		expect(git.initRepo).not.toHaveBeenCalled();
	});

	test('a failing feature also undoes the features enabled before it', async () => {
		touch(root, 'package.json', '{}');
		const before = snapshot(root);
		const paths = tree(root);
		const features = [
			{
				key: 'good',
				label: 'Good',
				detect: (api) => api.exists('assets/good.css'),
				onEnable(api) {
					api.write('assets/good.css', 'body {}');
					api.editPackageJson((pkg) => {
						pkg.good = true;
					});
				},
				onDisable() {},
			},
			{
				key: 'bad',
				label: 'Bad',
				detect: () => false,
				onEnable() {
					throw new Error('hook failed');
				},
				onDisable() {},
			},
		];
		await capture(async () => {
			await expect(
				run(
					{ ...stepConfig, features },
					{
						root,
						argv: [
							'--yes',
							'--name=Acme Blog',
							'--features=good,bad',
						],
					}
				)
			).rejects.toThrow('Feature setup failed: bad');
		});
		expect(snapshot(root)).toEqual(before);
		expect(tree(root)).toEqual(paths);
	});

	test('a feature whose own undo fails is reported, not announced as undone', async () => {
		const feature = {
			key: 'demo',
			label: 'Demo',
			detect: () => false,
			onEnable(api) {
				api.write('demo.txt', 'on');
				throw new Error('hook failed');
			},
			onDisable() {},
		};
		const remove = fs.rmSync;
		jest.spyOn(fs, 'rmSync').mockImplementation((target, ...options) => {
			if (target === path.join(root, 'demo.txt')) {
				throw new Error('demo undo failed');
			}
			return remove(target, ...options);
		});
		let failure;
		const output = await capture(async () => {
			failure = await run(
				{ ...stepConfig, features: [feature] },
				{
					root,
					argv: ['--yes', '--name=Acme Blog', '--features=demo'],
				}
			).catch((error) => error);
		});
		expect(failure).toBeInstanceOf(AggregateError);
		expect(failure.message).toBe(
			'Feature setup failed: demo; rollback failed: demo undo failed'
		);
		expect(output.stdout + output.stderr).toContain(
			'some changes could not be undone (demo undo failed)'
		);
		expect(output.stdout + output.stderr).not.toContain('init undid');
		// Everything else was still restored.
		expect(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8')).toBe(
			'Starter Theme'
		);
		expect(fs.existsSync(path.join(root, '.wp-scaffold.json'))).toBe(false);
	});

	test('identity persistence failure after Composer undoes setup, including vendor/', async () => {
		touch(root, 'composer.json', '{}');
		const before = snapshot(root);
		const paths = tree(root);
		execFileSync.mockImplementationOnce(() => {
			touch(root, 'vendor/autoload.php', '<?php');
		});
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
		expect(execFileSync).toHaveBeenCalledTimes(1);
		expect(snapshot(root)).toEqual(before);
		expect(tree(root)).toEqual(paths);
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
		'setup rejects malformed cleanup targets %j before changing files',
		async (targets) => {
			touch(root, 'keep.txt', 'keep');
			await capture(async () => {
				await expect(
					run(
						{
							...config,
							cleanup: { targets },
							steps: { cleanup: true },
						},
						{ root, argv: ['--yes', '--name=Acme Blog'] }
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
		// The project's own file at a cleanup target path.
		touch(root, 'CONTRIBUTING.md', 'Contribute to our site.');
		await setUp(['--reinit', '--yes', '--name=Cedar Blog']);
		expect(process.exitCode).toBeUndefined();
		expect(read('README.md')).toBe('Our own README\n');
		expect(read('README.theme.md')).toBe('# Template\n');
		expect(read('package.json')).toBe(ownPackage);
		expect(read('CONTRIBUTING.md')).toBe('Contribute to our site.');
	});

	test.each([
		['--clean', false],
		['-c', false],
		['--clean', true],
		['-c', true],
	])(
		'%s is an unknown argument (already set up: %s)',
		async (flag, setUpFirst) => {
			if (setUpFirst) {
				await setUp(['--yes', '--name=Acme Blog']);
				touch(root, 'CONTRIBUTING.md', 'Contribute to our site.');
			}
			const before = snapshot(root);
			const output = await setUp([flag]);
			expect(output.stdout + output.stderr).toContain(
				`Unknown argument(s): ${flag}`
			);
			expect(process.exitCode).toBe(1);
			expect(snapshot(root)).toEqual(before);
		}
	);

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

	test('a JSON file that fails to parse undoes setup, and a plain rerun is a clean first setup', async () => {
		touch(root, 'package.json', '{ broken');
		const before = snapshot(root);
		const paths = tree(root);
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
			'init undid the changes it made'
		);
		expect(snapshot(root)).toEqual(before);
		expect(tree(root)).toEqual(paths);

		// Fix the JSON and run setup again: no marker, so it is a first setup.
		touch(root, 'package.json', starterPackage);
		process.exitCode = undefined;
		await setUp(['--yes', '--name=Acme Blog']);
		expect(process.exitCode).toBeUndefined();
		expect(read('README.md')).toBe('# Acme Blog\n');
		expect(exists('README.theme.md')).toBe(false);
		expect(exists('CONTRIBUTING.md')).toBe(false);
		expect(read('package.json')).toBe(setupPackage);
	});

	test('a failure after the key removals and a target deletion undoes all of cleanup', async () => {
		touch(root, 'NOTES.md', 'Starter notes');
		const twoTargets = {
			...cleanupConfig,
			cleanup: {
				...cleanupConfig.cleanup,
				targets: ['CONTRIBUTING.md', 'NOTES.md'],
			},
		};
		const before = snapshot(root);
		const paths = tree(root);
		const rename = fs.renameSync;
		const spy = jest
			.spyOn(fs, 'renameSync')
			.mockImplementation((from, to) => {
				if (from === path.join(root, 'NOTES.md')) {
					throw new Error('target removal failed');
				}
				return rename(from, to);
			});
		await capture(async () => {
			await expect(
				run(twoTargets, { root, argv: ['--yes', '--name=Acme Blog'] })
			).rejects.toThrow('target removal failed');
		});
		spy.mockRestore();
		expect(snapshot(root)).toEqual(before);
		expect(tree(root)).toEqual(paths);

		process.exitCode = undefined;
		await setUp(['--yes', '--name=Acme Blog'], twoTargets);
		expect(process.exitCode).toBeUndefined();
		expect(exists('NOTES.md')).toBe(false);
		expect(exists('CONTRIBUTING.md')).toBe(false);
		expect(read('package.json')).toBe(setupPackage);
	});

	test('a failed --reinit restores the previous identity and files', async () => {
		await setUp(['--yes', '--name=Acme Blog']);
		const before = snapshot(root);
		const paths = tree(root);
		const write = fs.writeFileSync;
		let failed = false;
		jest.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
			if (!failed && path.basename(file) === '.wp-scaffold.json') {
				failed = true;
				throw new Error('identity write failed');
			}
			return write(file, ...args);
		});
		await capture(async () => {
			await expect(
				run(cleanupConfig, {
					root,
					argv: ['--reinit', '--yes', '--name=Cedar Blog'],
				})
			).rejects.toThrow('identity write failed');
		});
		expect(snapshot(root)).toEqual(before);
		expect(tree(root)).toEqual(paths);
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

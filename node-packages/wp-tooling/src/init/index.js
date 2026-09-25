/* eslint no-console: 0 */

/**
 * Init engine -- shared project setup for rtCamp WordPress starters.
 *
 * Consumed by a thin `bin/init.js` in each starter (theme / plugin), which calls
 * `run( config, { root } )` with a per-project `scaffold.config.js`. All terminal
 * I/O goes through `@rtcamp/wp-tooling/ui`.
 *
 * Flow: confirm -> name (validated) -> review identity -> rename + search-replace
 * -> apply version -> select features -> remove declined examples -> persist
 * `.wp-scaffold.json` -> composer dump-autoload -> cleanup -> optional git + Husky
 * -> initial commit.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Every UI primitive -- Wizard, prompts, spinner, styled status lines, table --
// comes from the wp-tooling kit.
const ui = require('../ui');
const debug = require('../debug');

const {
	identityFromName,
	validateName,
	buildIdentityReplacements,
	editIdentityFields,
} = require('./identity');
const {
	collectFiles,
	replaceInFiles,
	renameFiles,
	applyVersion,
} = require('./transform');
const {
	writeIdentityFile,
	readIdentityFile,
	IdentityFileError,
} = require('./persist');
const { initRepo, commitAll, installGitHooks } = require('./git');
const { runCleanup } = require('./cleanup');
const {
	validateFeatures,
	makeFeatureApi,
	detectMap,
	safeDetectMap,
	retiredKeys,
	toggleFeatures,
} = require('./features');
const { manageFlow, showStatus } = require('./manage');
const { applyExamples } = require('./examples');
const { listCapabilities, showCapabilities } = require('./capabilities');
const { formatErrorPayload } = require('../scaffolds/errors');

const DEFAULT_VERSION = '1.0.0';
const GENERATED_BY = '@rtcamp/wp-tooling init';

/**
 * Capitalise the first letter of a word.
 *
 * @param {string} word - Input.
 * @return {string} Capitalised word.
 */
const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Print CLI usage.
 *
 * @param {string} kind - "theme" / "plugin".
 * @return {void}
 */
const printHelp = (kind) => {
	console.log(`
Usage: npm run init [-- options]

Set up this ${kind}: rename the starter tokens to your project name, apply the
version, persist identity to .wp-scaffold.json, then optional git / Husky / cleanup.

Once set up (.wp-scaffold.json exists), 'npm run init' enters MANAGE mode to
edit project details (name, namespace, prefixes, ...) and toggle optional
features. Re-runnable any time.

Scaffold options (first run):
  --name=NAME      Use NAME without prompting (required with --yes).
  --version=VER    Set the project version (default 1.0.0).
  -y, --yes        Accept defaults, no prompts; for CI. Needs --name.
  --remove-examples[=a,b]  Remove all (or just the listed) capability sets.
  --keep-examples    Keep every capability set (non-interactive).
  --features=a,b     Enable exactly these optional features (empty = none).
  --enable=a,b       Enable features (delta over defaults).
  --disable=a,b      Disable features (delta over defaults).
  --reinit         Force a fresh scaffold even if already set up.

  Interactive runs show ONE grouped "Select the capabilities to include"
  prompt (by category); unchecking a capability removes it entirely.

Manage options (after set up):
  --features=a,b   Set the exact enabled feature set (empty = none).
  --enable=a,b     Enable features (delta).
  --disable=a,b    Disable features (delta).
  -y, --yes        Apply the flag selection without confirming.

Query options (any time, before or after set up):
  --list           List capabilities and optional features, then exit.
  --json           With --list: emit one JSON line
                   ({ mode, capabilities, features, warnings }).

General:
  -c, --clean      Run cleanup only (remove scaffolding files).
  -h, --help       Show this help.
`);
};

/**
 * Parse CLI flags for the setup flow.
 *
 * @param {string[]} argv - Arguments (without --help/--clean).
 * @return {{ flags: Object, unknown: string[] }} Parsed flags and any unrecognised args.
 */
const parseFlags = (argv) => {
	const flags = { yes: false };
	const unknown = [];

	argv.forEach((arg) => {
		if ('--yes' === arg || '-y' === arg) {
			flags.yes = true;
		} else if (arg.startsWith('--name=')) {
			flags.name = arg.slice('--name='.length);
		} else if (arg.startsWith('--version=')) {
			flags.version = arg.slice('--version='.length);
		} else if ('--remove-examples' === arg) {
			flags.removeExamples = true;
		} else if (arg.startsWith('--remove-examples=')) {
			flags.removeExamples = arg
				.slice('--remove-examples='.length)
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
		} else if ('--keep-examples' === arg) {
			flags.keepExamples = true;
		} else if (arg.startsWith('--features=')) {
			flags.features = arg
				.slice('--features='.length)
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
		} else if (arg.startsWith('--enable=')) {
			flags.enable = arg
				.slice('--enable='.length)
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
		} else if (arg.startsWith('--disable=')) {
			flags.disable = arg
				.slice('--disable='.length)
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
		} else {
			unknown.push(arg);
		}
	});

	return { flags, unknown };
};

/**
 * The starter's placeholder identity (replacement source for a fresh scaffold).
 *
 * @param {Object} config - Per-project scaffold config.
 * @return {Object} The full placeholder identity.
 */
const placeholderIdentity = (config) =>
	identityFromName(config.source.name, config, config.source);

/**
 * Build replacement pairs + persisted payload for a chosen target identity.
 *
 * @param {Object} config   - Per-project scaffold config.
 * @param {Object} targetId - The full target identity (post-edit).
 * @return {Object} { replacements, persistPayload }
 */
const contextFromIdentity = (config, targetId) => {
	const replacements = buildIdentityReplacements(
		placeholderIdentity(config),
		targetId
	);

	const persistPayload = {
		name: targetId.name,
		kind: config.kind,
		version: targetId.version,
		slug: targetId.textDomain,
		textDomain: targetId.textDomain,
		package: targetId.package,
		namespace: targetId.namespace,
		functionPrefix: targetId.functionPrefix,
		constantPrefix: targetId.constantPrefix,
		cssPrefix: targetId.cssPrefix,
		features: {},
		generatedBy: GENERATED_BY,
	};

	return { replacements, persistPayload };
};

/**
 * Run `composer dump-autoload` when a composer.json is present.
 *
 * @param {string} root - Project root.
 * @return {void}
 */
const composerDump = (root) => {
	if (!fs.existsSync(path.join(root, 'composer.json'))) {
		return;
	}
	const spin = ui.spinner('Running composer dump-autoload...');
	spin.start();
	try {
		execFileSync('composer', ['dump-autoload'], {
			cwd: root,
			stdio: 'pipe',
		});
		spin.succeed('Autoloader regenerated');
	} catch (err) {
		spin.fail('composer dump-autoload failed (continuing)');
		ui.warn(err.message);
	}
};

/**
 * Build the ordered wizard steps for the setup flow.
 *
 * @param {Object} config - Per-project scaffold config.
 * @param {string} root   - Project root.
 * @param {Object} flags  - Parsed CLI flags.
 * @return {Array<Object>} Wizard steps.
 */
const setupSteps = (config, root, flags) => {
	const kind = config.kind || 'project';
	const steps = config.steps || {};
	// Corrupt identity reads as absent here: run() already refused to enter
	// setup on corruption without --reinit, so reaching this point means the
	// file may be discarded.
	let existing = null;
	try {
		existing = readIdentityFile(root);
	} catch (err) {
		if (!(err instanceof IdentityFileError)) {
			throw err;
		}
		existing = null;
	}

	return [
		{
			name: 'Confirm',
			async run(c) {
				if (existing) {
					ui.warn(
						`This ${kind} is already initialized (.wp-scaffold.json, name: "${existing.name}").`
					);
					const again = flags.yes
						? true
						: await ui.confirm({
								message: 'Run setup again anyway?',
								defaultValue: false,
							});
					if (!again) {
						c.cancelled = true;
						return;
					}
				}
				if (flags.yes) {
					return;
				}
				const go = await ui.confirm({
					message: `Set up this ${kind} now?`,
					defaultValue: false,
				});
				if (!go) {
					c.cancelled = true;
				}
			},
		},
		{
			name: 'Project name',
			skip: (c) => c.cancelled,
			async run(c) {
				if (flags.name) {
					const err = validateName(flags.name);
					if (err) {
						ui.error(`--name: ${err}`);
						c.cancelled = true;
						process.exitCode = 1;
						return;
					}
					c.name = flags.name.trim();
					return;
				}
				c.name = await ui.text({
					message: `Enter ${kind} name (shown in WordPress admin)`,
					validate: validateName,
				});
			},
		},
		{
			name: 'Review',
			skip: (c) => c.cancelled,
			async run(c) {
				const start = identityFromName(c.name, config, {});
				start.version =
					flags.version || config.version || DEFAULT_VERSION;

				const { id, confirmed } = await editIdentityFields(
					config,
					start,
					ui,
					flags,
					true
				);
				if (!confirmed) {
					c.cancelled = true;
					ui.warn('Setup cancelled. Nothing was changed.');
					return;
				}

				const ctx = contextFromIdentity(config, id);
				c.target = id;
				c.version = id.version;
				c.replacements = ctx.replacements;
				c.persistPayload = ctx.persistPayload;
			},
		},
		{
			name: 'Apply identity',
			skip: (c) => c.cancelled,
			async run(c) {
				const files = collectFiles(root);
				const changed = replaceInFiles(files, c.replacements, ui);
				const renamed = renameFiles(files, c.replacements, ui);
				ui.success(
					`Updated ${changed} file(s), renamed ${renamed} file(s)`
				);
			},
		},
		{
			name: 'Apply version',
			skip: (c) => c.cancelled || !config.versionFiles,
			async run(c) {
				// Resolve function paths against the chosen identity; files may have just been renamed.
				const target = { ...c.target, kebab: c.target.textDomain };
				const files = config.versionFiles.map((spec) => ({
					...spec,
					path:
						'function' === typeof spec.path
							? spec.path(target)
							: spec.path,
				}));
				applyVersion(root, files, c.version, ui);
			},
		},
		{
			// One categorized prompt for BOTH example capabilities (keep/remove)
			// and optional features (enable/disable). Non-interactive when any
			// selection flag is present (AI/CI); otherwise a grouped "keep" tree.
			name: 'Select capabilities',
			skip: (c) =>
				c.cancelled ||
				(!(config.features || []).length &&
					!(
						config.examples && (config.examples.groups || []).length
					)),
			async run(c) {
				const features = config.features || [];
				const groups =
					(config.examples && config.examples.groups) || [];
				const api = makeFeatureApi(root, c.persistPayload, ui);

				let removeKeys; // example group keys to remove
				let wantOn; // feature keys to enable

				const interactive =
					!flags.yes &&
					undefined === flags.removeExamples &&
					!flags.keepExamples &&
					undefined === flags.features &&
					!flags.enable &&
					!flags.disable;

				if (interactive) {
					removeKeys = new Set();
					wantOn = new Set();
					if (features.length || groups.length) {
						// Build capabilities (examples default-checked = kept;
						// features checked iff defaultOn), grouped by category.
						const caps = [
							...groups.map((g) => ({
								key: g.key,
								label: g.label,
								category: g.category || 'Other',
								checked: true,
							})),
							...features.map((f) => ({
								key: f.key,
								label: f.label,
								category: f.category || 'Other',
								checked: !!f.defaultOn,
							})),
						];
						const order = [];
						const byCat = new Map();
						for (const entry of caps) {
							if (!byCat.has(entry.category)) {
								byCat.set(entry.category, []);
								order.push(entry.category);
							}
							byCat.get(entry.category).push(entry);
						}
						const treeGroups = order.map((category) => ({
							label: category,
							items: byCat.get(category).map((entry) => ({
								label: entry.label,
								checked: entry.checked,
							})),
						}));
						const checked = new Set(
							await ui.checkboxTree({
								message:
									'Select the capabilities to include in your plugin',
								groups: treeGroups,
							})
						);
						removeKeys = new Set(
							groups
								.filter((g) => !checked.has(g.label))
								.map((g) => g.key)
						);
						wantOn = new Set(
							features
								.filter((f) => checked.has(f.label))
								.map((f) => f.key)
						);
					}
				} else {
					// Examples from flags.
					if (true === flags.removeExamples) {
						removeKeys = new Set(groups.map((g) => g.key));
					} else if (Array.isArray(flags.removeExamples)) {
						const validKeys = new Set(groups.map((g) => g.key));
						const unknownKeys = flags.removeExamples.filter(
							(k) => !validKeys.has(k)
						);
						if (unknownKeys.length) {
							throw usageError(
								`Unknown --remove-examples key(s): ${unknownKeys.join(
									', '
								)}. Valid keys: ${
									[...validKeys].sort().join(', ') ||
									'(none declared)'
								}`
							);
						}
						removeKeys = new Set(flags.removeExamples);
					} else {
						removeKeys = new Set(); // --keep-examples / --yes default
					}
					// Features from flags (--features exact set, or --enable /
					// --disable deltas over defaultOn + detected).
					if (undefined !== flags.features) {
						wantOn = new Set(flags.features);
					} else {
						const detected = detectMap(config, api);
						wantOn = new Set(
							features
								.filter((f) => f.defaultOn || detected[f.key])
								.map((f) => f.key)
						);
						(flags.enable || []).forEach((k) => wantOn.add(k));
						(flags.disable || []).forEach((k) => wantOn.delete(k));
					}
				}

				// Remove declined example capabilities, then toggle features.
				if (groups.length) {
					applyExamples(config, root, ui, removeKeys);
				}
				// Record the selection: `--list` reconciles this intent against
				// detected reality instead of re-deriving it from disk alone.
				c.persistPayload.examples = {
					removed: Array.from(removeKeys).sort(),
				};
				if (features.length) {
					const result = await toggleFeatures(config, root, {
						mode: 'scaffold',
						wantOn,
						flags,
						api,
						ui,
					});
					c.persistPayload.features =
						(result && result.finalMap) || detectMap(config, api);
				} else {
					c.persistPayload.features = {};
				}
			},
		},
		{
			name: 'Persist identity',
			skip: (c) => c.cancelled,
			async run(c) {
				writeIdentityFile(
					root,
					{
						...c.persistPayload,
						generatedAt: new Date().toISOString(),
					},
					ui
				);
			},
		},
		{
			name: 'Regenerate autoloader',
			skip: (c) => c.cancelled || !steps.composer,
			async run() {
				composerDump(root);
			},
		},
		{
			name: 'Cleanup',
			skip: (c) => c.cancelled || !steps.cleanup,
			async run() {
				runCleanup(
					root,
					(config.cleanup && config.cleanup.targets) || [],
					ui
				);
			},
		},
		{
			name: 'Git',
			skip: (c) => c.cancelled || !steps.git,
			async run(c) {
				const go = flags.yes
					? false
					: await ui.confirm({
							message:
								'Initialize a git repository? (removes any existing .git)',
							defaultValue: false,
						});
				if (go) {
					c.gitReady = initRepo(root, ui);
				}
			},
		},
		{
			name: 'Git hooks',
			// `husky` is the legacy alias for this gate; prefer `hooks`. Remove the
			// fallback once consumers migrate their scaffold.config to `steps.hooks`.
			skip: (c) =>
				c.cancelled || !c.gitReady || !(steps.hooks ?? steps.husky),
			async run() {
				const go = flags.yes
					? true
					: await ui.confirm({
							message:
								'Install git hooks (pre-commit lint + commit-msg)?',
							defaultValue: true,
						});
				if (go) {
					await installGitHooks(root, ui);
				}
			},
		},
		{
			name: 'Commit',
			skip: (c) => c.cancelled || !c.gitReady,
			async run() {
				commitAll(
					root,
					`Initialize project using ${config.repoUrl || GENERATED_BY}`,
					ui
				);
			},
		},
	];
};

/**
 * Run the interactive setup flow.
 *
 * @param {Object} config - Per-project scaffold config.
 * @param {string} root   - Project root.
 * @param {Object} flags  - Parsed CLI flags.
 * @return {Promise<void>}
 */
const setupFlow = async (config, root, flags) => {
	const kind = config.kind || 'project';
	ui.heading(`${cap(kind)} setup`);

	const ctx = { cancelled: false };
	await new ui.Wizard(setupSteps(config, root, flags), ctx).run();

	if (ctx.cancelled) {
		ui.warn('\nNothing was changed.');
		return;
	}

	ui.heading('Done');
	ui.success(`Your new ${kind} is ready.`);
	if (config.docsUrl) {
		ui.info(`Docs: ${config.docsUrl}`);
	}
};

/**
 * Run the cleanup-only flow (`--clean`).
 *
 * @param {Object} config - Per-project scaffold config.
 * @param {string} root   - Project root.
 * @return {Promise<void>}
 */
const cleanFlow = async (config, root) => {
	const kind = config.kind || 'project';
	const go = await ui.confirm({
		message: `Run ${kind} cleanup now?`,
		defaultValue: false,
	});
	if (!go) {
		ui.warn('Cleanup skipped.');
		return;
	}
	const removed = runCleanup(
		root,
		(config.cleanup && config.cleanup.targets) || [],
		ui
	);
	ui.success(`Cleanup complete (${removed} removed).`);
};

/**
 * Emit one machine-readable error line on stderr -- the `--json` failure
 * contract, shared with `wp-tooling add` via `formatErrorPayload`.
 *
 * @param {Error} err - The error to report.
 * @return {void}
 */
const emitJsonError = (err) => {
	process.stderr.write(`${JSON.stringify(formatErrorPayload(err))}\n`);
};

/**
 * Build a usage error carrying the stable `EUSAGE` machine code.
 *
 * @param {string} message - Human-readable message.
 * @return {Error} Coded error.
 */
const usageError = (message) =>
	Object.assign(new Error(message), { code: 'EUSAGE' });

/**
 * `--list`: report the project's capabilities and optional features, in either
 * mode, without mutating anything. Human tables by default; a single JSON line
 * ({ mode, capabilities, features, warnings }) with `--json` -- the AI-facing
 * contract, so orchestrators never read the scaffold config to enumerate them.
 *
 * Feature `on` means the EFFECTIVE state in both modes: detected reality in
 * manage mode, `defaultOn || detected` (what a non-interactive setup would
 * enable) in setup mode. Detect probes are guarded: a throwing probe degrades
 * that feature to `on: null` plus a warning instead of breaking the contract.
 *
 * @param {Object}      config              - Per-project scaffold config.
 * @param {string}      root                - Project root.
 * @param {Object}      opts                - Options.
 * @param {string}      opts.mode           - 'setup' | 'manage'.
 * @param {boolean}     opts.json           - Emit machine-readable JSON.
 * @param {Object|null} opts.identity       - Parsed .wp-scaffold.json (manage only).
 * @param {string[]}    [opts.seedWarnings] - Warnings collected by the caller.
 * @return {void}
 */
const listFlow = (config, root, { mode, json, identity, seedWarnings }) => {
	const kind = config.kind || 'project';
	const warnings = [...(seedWarnings || [])];
	const manage = 'manage' === mode;

	const capabilityRows = listCapabilities(
		config,
		root,
		manage ? identity : null
	);
	if (
		manage &&
		capabilityRows.length &&
		capabilityRows.every((r) => null === r.intent)
	) {
		warnings.push(
			'capability selection was not recorded by this setup (older init); state is disk-detected only.'
		);
	}
	const capabilities = capabilityRows.map((r) =>
		manage
			? {
					key: r.key,
					label: r.label,
					category: r.category,
					module: r.module,
					present: r.present,
					intent: r.intent,
					drift: r.drift,
				}
			: {
					key: r.key,
					label: r.label,
					category: r.category,
					module: r.module,
					present: r.present,
				}
	);

	// Detection needs an identity on the api (probes read api.identity.*).
	// Pre-setup, the starter's own placeholder identity IS the on-disk reality.
	let apiIdentity = identity;
	if (!manage) {
		apiIdentity = config.source ? placeholderIdentity(config) : {};
	}
	const api = makeFeatureApi(root, apiIdentity, ui);
	const { map, errors } = safeDetectMap(config, api);
	errors.forEach(({ key, message }) =>
		warnings.push(`${key}: feature detect failed: ${message}`)
	);

	const persisted = (manage && identity && identity.features) || {};
	const features = (config.features || []).map((f) => {
		const detected = map[f.key];
		// Setup mode reports the non-interactive default: defaultOn || detected.
		let on = detected;
		if (!manage && f.defaultOn) {
			on = true;
		}
		const row = {
			key: f.key,
			label: f.label,
			description: f.description || '',
			on,
		};
		if (manage) {
			row.intent = Boolean(persisted[f.key]);
			row.drift = null === detected ? false : detected !== row.intent;
		}
		return row;
	});
	if (manage) {
		retiredKeys(config, persisted).forEach((key) =>
			warnings.push(
				`${key}: recorded in .wp-scaffold.json but no longer declared.`
			)
		);
	}

	if (json) {
		process.stdout.write(
			`${JSON.stringify({ mode, capabilities, features, warnings })}\n`
		);
		return;
	}

	ui.heading(
		`${cap(kind)} — ${manage ? 'status' : 'available capabilities'}`
	);
	showCapabilities(capabilityRows, ui, { mode });
	showStatus(features, [], ui);
	warnings.forEach((w) => ui.warn(w));
};

/**
 * Entry point. Called by each starter's `bin/init.js`.
 *
 * @param {Object}   config         - Per-project scaffold config.
 * @param {Object}   options        - Options.
 * @param {string}   options.root   - Project root (required).
 * @param {string[]} [options.argv] - CLI args (defaults to process args).
 * @return {Promise<void>}
 */
const run = async (config, options = {}) => {
	const root = options.root;
	const argv = options.argv || process.argv.slice(2);
	const kind = config.kind || 'project';

	if (!root) {
		throw new Error('init: options.root is required');
	}

	if (argv.includes('--help') || argv.includes('-h')) {
		printHelp(kind);
		return;
	}

	// Diagnostic timing + output capture (opt-in via WP_TOOLING_DEBUG); inert
	// when off. --help returns above, so it is intentionally not timed.
	// Flag values (e.g. --name=<value>) are caller-supplied and may be
	// sensitive, so only the fixed command name + structured context are
	// logged -- never raw argv (matches src/scaffolds/add.js).
	debug.start('init', { kind, cwd: root });
	let result = 'ok';
	try {
		// --list / --json: the read-only machine-query contract. Intercepted ahead
		// of every other flow so config and identity failures also answer in JSON
		// when asked to: one stdout line on success, one stderr line on failure.
		if (argv.includes('--list') || argv.includes('--json')) {
			const wantJson = argv.includes('--json');
			try {
				if (!argv.includes('--list')) {
					throw usageError('--json is only supported with --list');
				}
				// --manage is excluded: mode derives from identity/--reinit alone,
				// so accepting it here would silently ignore it. --yes is accepted
				// (and ignored) so scripted `--list --yes` calls keep working.
				const allowed = new Set([
					'--list',
					'--json',
					'--reinit',
					'--yes',
					'-y',
				]);
				const extra = argv.filter((arg) => !allowed.has(arg));
				if (extra.length) {
					throw usageError(
						`--list cannot be combined with: ${extra.join(' ')}`
					);
				}
				try {
					validateFeatures(config);
				} catch (err) {
					err.code = 'ECONFIG';
					throw err;
				}
				const seedWarnings = [];
				let identity = null;
				try {
					identity = readIdentityFile(root);
				} catch (err) {
					// Only an actual corrupt-identity error is discardable via
					// --reinit; a filesystem error (EACCES, EIO, ...) must not be
					// treated as "no identity, safe to overwrite".
					if (
						!(err instanceof IdentityFileError) ||
						!argv.includes('--reinit')
					) {
						throw err;
					}
					// --reinit means "discard what's there": report setup mode.
					seedWarnings.push(
						'.wp-scaffold.json is corrupt; --reinit will overwrite it.'
					);
				}
				const mode =
					identity && !argv.includes('--reinit') ? 'manage' : 'setup';
				listFlow(config, root, {
					mode,
					json: wantJson,
					identity: 'manage' === mode ? identity : null,
					seedWarnings,
				});
			} catch (err) {
				result = 'error';
				if (wantJson) {
					emitJsonError(err);
				} else {
					ui.error(err.message);
				}
				process.exitCode = 1;
			}
			return;
		}

		try {
			// Cleanup works in either mode.
			if (argv.includes('--clean') || argv.includes('-c')) {
				const others = argv.filter(
					(arg) => '--clean' !== arg && '-c' !== arg
				);
				if (others.length) {
					ui.error('Invalid arguments.');
					process.exitCode = 1;
					return;
				}
				await cleanFlow(config, root);
				return;
			}

			// Validate the feature manifest once, before touching disk, for both modes.
			try {
				validateFeatures(config);
			} catch (err) {
				ui.error(err.message);
				process.exitCode = 1;
				return;
			}

			// A corrupt identity file must not silently re-enter setup mode (that
			// would re-run destructive scaffold steps on an initialized project).
			// Only an explicit --reinit may discard it.
			let identity = null;
			try {
				identity = readIdentityFile(root);
			} catch (err) {
				// Only an actual corrupt-identity error is discardable via
				// --reinit; a filesystem error (EACCES, EIO, ...) must not be
				// treated as "no identity, safe to overwrite".
				if (
					!(err instanceof IdentityFileError) ||
					!argv.includes('--reinit')
				) {
					ui.error(err.message);
					process.exitCode = 1;
					return;
				}
				ui.warn(
					'.wp-scaffold.json is corrupt; --reinit will overwrite it.'
				);
			}

			// Manage mode: already scaffolded (unless forced to re-scaffold with --reinit).
			if (identity && !argv.includes('--reinit')) {
				await manageFlow(config, root, argv, identity, ui, () =>
					setupFlow(config, root, { yes: false })
				);
				return;
			}

			// Scaffold mode (no identity, or --reinit).
			const setupArgv = argv.filter((arg) => '--reinit' !== arg);
			const { flags, unknown } = parseFlags(setupArgv);
			if (unknown.length) {
				ui.error(`Unknown argument(s): ${unknown.join(' ')}`);
				process.exitCode = 1;
				return;
			}
			if (flags.yes && !flags.name) {
				ui.error('--yes requires --name=<name>.');
				process.exitCode = 1;
				return;
			}

			await setupFlow(config, root, flags);
		} catch (err) {
			if (err instanceof ui.CancelledError) {
				result = 'cancelled';
				ui.warn('\nCancelled.');
				process.exitCode = 130;
				return;
			}
			if (err instanceof IdentityFileError) {
				// Mid-flow corruption (e.g. a manage re-read): report, don't crash.
				result = 'error';
				ui.error(err.message);
				process.exitCode = 1;
				return;
			}
			result = 'error';
			throw err;
		}
	} finally {
		debug.finish({
			result: 'ok' === result && process.exitCode ? 'error' : result,
		});
	}
};

module.exports = { run, makeFeatureApi };

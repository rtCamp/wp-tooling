/**
 * Manage mode -- re-runnable editing of an already-scaffolded project: edit
 * identity fields, toggle optional features, and show status.
 *
 * Entered when .wp-scaffold.json exists. Feature toggling shares one
 * apply+persist path with the scaffold flow's initial pick via `toggleFeatures`
 * (in ./features); identity editing routes to `editDetailsFlow` (in ./identity).
 */

'use strict';

const { makeFeatureApi, reconcile, toggleFeatures } = require('./features');
const { readIdentityFile, readFeatures } = require('./persist');
const { editDetailsFlow } = require('./identity');

/**
 * Capitalise the first letter.
 *
 * @param {string} word - Input.
 * @return {string} Capitalised.
 */
const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Split a comma list flag value into trimmed keys.
 *
 * @param {string} value - Raw flag value.
 * @return {string[]} Keys.
 */
const splitList = (value) =>
	value
		? value
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		: [];

/**
 * Parse manage-mode CLI flags.
 *
 * @param {string[]} argv - Arguments.
 * @return {{flags: Object, unknown: string[]}} Parsed.
 */
const parseManageFlags = (argv) => {
	const flags = { yes: false, list: false };
	const unknown = [];

	argv.forEach((arg) => {
		if ('--yes' === arg || '-y' === arg) {
			flags.yes = true;
		} else if ('--list' === arg) {
			flags.list = true;
		} else if ('--manage' === arg) {
			// Explicit manage marker; already in manage mode, no-op.
		} else if (arg.startsWith('--features=')) {
			flags.features = splitList(arg.slice('--features='.length));
		} else if (arg.startsWith('--enable=')) {
			flags.enable = splitList(arg.slice('--enable='.length));
		} else if (arg.startsWith('--disable=')) {
			flags.disable = splitList(arg.slice('--disable='.length));
		} else {
			unknown.push(arg);
		}
	});

	return { flags, unknown };
};

/**
 * Render a read-only feature status table.
 *
 * @param {Array}    rows    - Reconciled rows.
 * @param {string[]} unknown - Retired keys still recorded.
 * @param {Object}   ui      - UI.
 * @return {void}
 */
const showStatus = (rows, unknown, ui) => {
	if (!rows.length) {
		ui.info('No optional features are declared for this project.');
		return;
	}
	ui.table(
		rows.map((r) => [
			r.label,
			`${r.on ? 'enabled' : 'disabled'}${r.drift ? '  (drift)' : ''}`,
		]),
		{ title: 'Feature status' }
	);
	rows.forEach((r) => {
		if (r.description) {
			ui.info(`${r.label}: ${r.description}`);
		}
	});
	(unknown || []).forEach((key) =>
		ui.warn(`${key}: recorded in .wp-scaffold.json but no longer declared.`)
	);
};

/**
 * Read the persisted features map fresh (after a prior toggle in the same loop).
 *
 * @param {string} root - Project root.
 * @return {Object} Features map.
 */
const reqReadFeatures = (root) => readFeatures(root);

/**
 * Manage-mode entry. Routes flags or an interactive menu into `toggleFeatures`.
 *
 * @param {Object}   config   - Per-project scaffold config.
 * @param {string}   root     - Project root.
 * @param {string[]} argv     - CLI args.
 * @param {Object}   identity - Parsed .wp-scaffold.json.
 * @param {Object}   ui       - Merged UI.
 * @param {Function} reinit   - Callback to re-run the full scaffold flow.
 * @return {Promise<void>}
 */
const manageFlow = async (config, root, argv, identity, ui, reinit) => {
	const { flags, unknown } = parseManageFlags(argv);
	if (unknown.length) {
		ui.error(`Unknown argument(s): ${unknown.join(' ')}`);
		process.exitCode = 1;
		return;
	}
	if (flags.features && (flags.enable || flags.disable)) {
		ui.error('--features cannot be combined with --enable/--disable.');
		process.exitCode = 1;
		return;
	}
	if (flags.list && (flags.features || flags.enable || flags.disable)) {
		ui.error(
			'--list cannot be combined with --features/--enable/--disable.'
		);
		process.exitCode = 1;
		return;
	}

	const features = config.features || [];
	const api = makeFeatureApi(root, identity, ui);
	const { rows, unknown: retired } = reconcile(
		config,
		identity.features || {},
		api
	);

	if (flags.list) {
		showStatus(rows, retired, ui);
		return;
	}

	const validKeys = new Set(features.map((f) => f.key));
	const requested = [
		...(flags.features || []),
		...(flags.enable || []),
		...(flags.disable || []),
	];
	const badKey = requested.find((k) => !validKeys.has(k));
	if (badKey) {
		ui.error(
			`Unknown feature "${badKey}". Valid: ${[...validKeys].join(', ') || '(none)'}`
		);
		process.exitCode = 1;
		return;
	}

	const hasFlagSelection = Boolean(
		flags.features || flags.enable || flags.disable
	);
	if (flags.yes && !hasFlagSelection) {
		ui.error(
			'--yes in manage mode requires --features / --enable / --disable.'
		);
		process.exitCode = 1;
		return;
	}

	if (hasFlagSelection) {
		let wantOn;
		if (flags.features) {
			wantOn = new Set(flags.features);
		} else {
			wantOn = new Set(rows.filter((r) => r.on).map((r) => r.key));
			(flags.enable || []).forEach((k) => wantOn.add(k));
			(flags.disable || []).forEach((k) => wantOn.delete(k));
		}
		await toggleFeatures(config, root, {
			mode: 'manage',
			wantOn,
			flags,
			api,
			ui,
			rows,
			unknown: retired,
		});
		return;
	}

	// Interactive menu.
	ui.heading(`${cap(config.kind || 'project')} -- manage`);
	for (;;) {
		const choices = ['Edit project details'];
		if (features.length) {
			choices.push('Toggle features', 'Show status');
		}
		choices.push('Re-run full setup', 'Exit');

		const choice = await ui.radio({
			message: 'What would you like to do?',
			choices,
		});

		if ('Exit' === choice) {
			return;
		}
		if ('Edit project details' === choice) {
			await editDetailsFlow(
				config,
				root,
				readIdentityFile(root) || identity,
				ui,
				flags
			);
			continue;
		}
		if ('Show status' === choice) {
			const r = reconcile(config, reqReadFeatures(root), api);
			showStatus(r.rows, r.unknown, ui);
			continue;
		}
		if ('Re-run full setup' === choice) {
			await reinit();
			return;
		}
		// Toggle features: re-read fresh rows each loop.
		const r = reconcile(config, reqReadFeatures(root), api);
		await toggleFeatures(config, root, {
			mode: 'manage',
			flags,
			api,
			ui,
			rows: r.rows,
			unknown: r.unknown,
		});
	}
};

module.exports = { manageFlow, parseManageFlags, showStatus };

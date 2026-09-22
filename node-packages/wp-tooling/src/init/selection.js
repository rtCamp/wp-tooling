/** Resolve setup selections without modifying project files. */
'use strict';

const { detectMap, makeFeatureApi } = require('./features');

/**
 * Apply exact or delta flags to a starting feature selection.
 *
 * @param {Object}           flags    Parsed flags.
 * @param {Iterable<string>} defaults Starting enabled keys.
 * @return {Set<string>} Desired enabled keys; disable takes precedence.
 */
const selectFeatures = (flags, defaults) => {
	if (undefined !== flags.features) {
		return new Set(flags.features);
	}
	const selected = new Set(defaults);
	for (const key of flags.enable || []) {
		selected.add(key);
	}
	for (const key of flags.disable || []) {
		selected.delete(key);
	}
	return selected;
};

/**
 * Group capabilities for the checkbox UI, preserving declaration order.
 *
 * @param {Object[]} entries Labeled entries with checked defaults.
 * @return {Object[]} Checkbox groups.
 */
const groupCapabilities = (entries) => {
	const categories = new Map();
	for (const entry of entries) {
		const category = entry.category || 'Other';
		if (!categories.has(category)) {
			categories.set(category, []);
		}
		categories
			.get(category)
			.push({ label: entry.label, checked: entry.checked });
	}
	return [...categories].map(([label, items]) => ({ label, items }));
};

/**
 * Resolve example and feature choices before setup applies identity changes.
 *
 * @param {Object}  config         Scaffold configuration.
 * @param {string}  root           Project root.
 * @param {Object}  flags          Parsed flags.
 * @param {Object}  identity       Target identity supplied to feature probes.
 * @param {boolean} reinitializing Whether one-shot examples are already consumed.
 * @param {Object}  ui             Prompt interface.
 * @return {Promise<Object>} Removal keys and enabled feature keys.
 */
const selectCapabilities = async (
	config,
	root,
	flags,
	identity,
	reinitializing,
	ui
) => {
	const features = config.features || [];
	const groups = reinitializing ? [] : config.examples?.groups || [];
	const detected = detectMap(config, makeFeatureApi(root, identity, ui));
	const defaults = features
		.filter((feature) => feature.defaultOn || detected[feature.key])
		.map((feature) => feature.key);
	const interactive =
		!flags.yes &&
		!flags.keepExamples &&
		['removeExamples', 'features', 'enable', 'disable'].every(
			(key) => undefined === flags[key]
		);

	if (!interactive || (!features.length && !groups.length)) {
		return {
			wantOn: selectFeatures(flags, defaults),
			removeKeys: new Set(
				true === flags.removeExamples
					? groups.map((group) => group.key)
					: flags.removeExamples || []
			),
		};
	}
	const selected = new Set(defaults);
	const entries = [
		...groups.map((group) => ({ ...group, checked: true })),
		...features.map((feature) => ({
			...feature,
			checked: selected.has(feature.key),
		})),
	];
	const checked = new Set(
		await ui.checkboxTree({
			message: `Select the capabilities to include in your ${config.kind || 'project'}`,
			groups: groupCapabilities(entries),
		})
	);
	return {
		wantOn: new Set(
			features
				.filter((feature) => checked.has(feature.label))
				.map((feature) => feature.key)
		),
		removeKeys: new Set(
			groups
				.filter((group) => !checked.has(group.label))
				.map((group) => group.key)
		),
	};
};

module.exports = { selectFeatures, selectCapabilities };

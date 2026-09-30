/** Shared validation for mutating setup and manage requests. */
'use strict';

const path = require('path');
const { resolveWithin, validateRelativePath } = require('./transform');
const { resolveCleanupTargets } = require('./cleanup');
const { validateName, validateVersion } = require('./identity');

/**
 * Build a CLI usage error with a stable machine code.
 *
 * @param {string} message Expected input and received value.
 * @return {Error} Coded error.
 */
const usageError = (message) =>
	Object.assign(new Error(message), { code: 'EUSAGE' });

/**
 * Validate keys against a declared capability collection.
 *
 * @param {string[]} requested Requested keys.
 * @param {Object[]} declared  Manifest entries.
 * @param {string}   label     CLI flag or capability name.
 * @return {void}
 */
const validateKeys = (requested, declared, label) => {
	const valid = new Set(declared.map((entry) => entry.key));
	const unknown = requested.filter((key) => !valid.has(key));
	if (unknown.length) {
		throw usageError(
			`Unknown ${label} key(s): ${unknown.join(', ')}. Valid keys: ${[...valid].sort().join(', ') || '(none declared)'}`
		);
	}
};

/**
 * Validate feature flags consistently before detection or mutation.
 *
 * @param {Object} config Scaffold configuration.
 * @param {Object} flags  Parsed flags, preserving empty exact selections.
 * @return {void}
 */
const validateFeatureFlags = (config, flags) => {
	if (
		undefined !== flags.features &&
		(undefined !== flags.enable || undefined !== flags.disable)
	) {
		throw usageError(
			'--features cannot be combined with --enable/--disable.'
		);
	}
	validateKeys(
		[
			...(flags.features || []),
			...(flags.enable || []),
			...(flags.disable || []),
		],
		config.features || [],
		'feature'
	);
};

/**
 * Validate setup flags before the wizard can write any files.
 *
 * @param {Object} config Scaffold configuration.
 * @param {Object} flags  Parsed setup flags.
 * @return {void}
 */
const validateSetupFlags = (config, flags) => {
	validateFeatureFlags(config, flags);
	if (flags.keepExamples && undefined !== flags.removeExamples) {
		throw usageError(
			'--keep-examples cannot be combined with --remove-examples.'
		);
	}
	if (Array.isArray(flags.removeExamples)) {
		validateKeys(
			flags.removeExamples,
			config.examples?.groups || [],
			'--remove-examples'
		);
	}
	if (undefined !== flags.name) {
		const error = validateName(flags.name);
		if (error) {
			throw usageError(
				`--name: ${error} Received ${JSON.stringify(flags.name)}.`
			);
		}
	}
	const version = flags.version ?? config.version;
	if (undefined !== version) {
		const error = validateVersion(version);
		if (error) {
			throw usageError(
				`--version: ${error} Received ${JSON.stringify(version)}.`
			);
		}
	}
};

/**
 * Validate configured paths before setup changes identity or removes examples.
 *
 * @param {Object} config     Scaffold configuration.
 * @param {string} root       Project root.
 * @param {Object} [identity] Resolved identity for functional version paths.
 * @return {void}
 */
const validatePaths = (config, root, identity) => {
	const check = (value, boundary = root) => {
		validateRelativePath(value);
		if (resolveWithin(boundary, value) === path.resolve(boundary)) {
			throw new Error(
				`Expected a path below ${boundary}, received ${JSON.stringify(value)}`
			);
		}
	};
	resolveCleanupTargets(root, config.cleanup?.targets);
	check(config.featuresDir || 'bin/features');
	for (const feature of config.features || []) {
		for (const file of feature.apply?.files || []) {
			check(file.to);
			check(
				file.from,
				path.resolve(root, config.featuresDir || 'bin/features')
			);
		}
	}
	for (const group of config.examples?.groups || []) {
		for (const target of [
			...(group.strip || []),
			...(group.remove || []),
		]) {
			check(target);
		}
	}
	for (const spec of config.versionFiles || []) {
		if (!['json', 'css-header', 'php-header'].includes(spec.kind)) {
			throw new Error(
				`Expected version kind json, css-header or php-header, received ${JSON.stringify(spec.kind)}`
			);
		}
		if ('function' !== typeof spec.path) {
			check(spec.path);
		} else if (identity) {
			check(spec.path({ ...identity, kebab: identity.textDomain }));
		}
	}
};

module.exports = {
	usageError,
	validateFeatureFlags,
	validateSetupFlags,
	validatePaths,
};

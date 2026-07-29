/**
 * Tests for the project-config module (`.wp-tooling.json`):
 *   - detectIndent() finds tabs / spaces / nothing
 *   - writeConfig() preserves the indentation of an existing file
 *   - feature-file persistence helpers round-trip and tidy up after themselves
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	CONFIG_FILENAME,
	detectIndent,
	readConfig,
	writeConfig,
	setFeatureEnabled,
	setFeatureState,
	getFeatureFiles,
	clearFeatureFiles,
} = require('../../src/scaffolds/config');

function makeTmpDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tooling-config-'));
}

function rawConfig(cwd) {
	return fs.readFileSync(path.join(cwd, CONFIG_FILENAME), 'utf8');
}

describe('detectIndent()', () => {
	it('detects tab indentation', () => {
		expect(detectIndent('{\n\t"a": 1\n}\n')).toBe('\t');
	});

	it('detects two-space indentation', () => {
		expect(detectIndent('{\n  "a": 1\n}\n')).toBe('  ');
	});

	it('returns null for single-line / empty input', () => {
		expect(detectIndent('{"a":1}')).toBeNull();
		expect(detectIndent('')).toBeNull();
	});
});

describe('writeConfig() indentation', () => {
	it('preserves tabs when the file was written with tabs', () => {
		const cwd = makeTmpDir();
		fs.writeFileSync(
			path.join(cwd, CONFIG_FILENAME),
			'{\n\t"name": "My Theme",\n\t"features": {}\n}\n',
			'utf8'
		);
		// A feature toggle must not churn the file to a different indent.
		setFeatureEnabled(cwd, 'tailwind', true);
		const raw = rawConfig(cwd);
		expect(raw).toContain('\t"features"');
		expect(raw).not.toContain('  "features"');
		expect(readConfig(cwd)).toMatchObject({
			name: 'My Theme',
			features: { tailwind: true },
		});
	});

	it('defaults to two spaces for a new file', () => {
		const cwd = makeTmpDir();
		writeConfig(cwd, { features: {} });
		expect(rawConfig(cwd)).toContain('  "features"');
	});
});

describe('feature-file persistence', () => {
	const files = {
		ownedFiles: ['postcss.config.js'],
		confirmRemove: ['custom/css/tailwind.css'],
		gitignore: ['custom/css/_tailwind-theme.css'],
	};

	it('setFeatureState sets the flag and round-trips file lists in one write', () => {
		const cwd = makeTmpDir();
		setFeatureState(cwd, 'tailwind', true, files);
		expect(readConfig(cwd).features.tailwind).toBe(true);
		expect(getFeatureFiles(cwd, 'tailwind')).toEqual(files);
	});

	it('setFeatureState preserves an existing file indentation', () => {
		const cwd = makeTmpDir();
		fs.writeFileSync(
			path.join(cwd, CONFIG_FILENAME),
			'{\n\t"name": "My Theme"\n}\n',
			'utf8'
		);
		setFeatureState(cwd, 'tailwind', true, files);
		const raw = rawConfig(cwd);
		expect(raw).toContain('\t"features"');
		expect(raw).not.toContain('  "features"');
	});

	it('returns null when nothing was persisted', () => {
		expect(getFeatureFiles(makeTmpDir(), 'tailwind')).toBeNull();
	});

	it('clearFeatureFiles removes the entry and an empty block', () => {
		const cwd = makeTmpDir();
		setFeatureState(cwd, 'tailwind', true, files);
		clearFeatureFiles(cwd, 'tailwind');
		expect(getFeatureFiles(cwd, 'tailwind')).toBeNull();
		expect(readConfig(cwd).featureFiles).toBeUndefined();
	});
});

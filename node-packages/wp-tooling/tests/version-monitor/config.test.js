'use strict';

const path = require('path');
const {
	loadConfig,
	parseConfigYaml,
	validate,
} = require('../../src/version-monitor/config');
const { FIXTURE_ROOT } = require('./_helpers');

describe('parseConfigYaml', () => {
	it('parses inline-flow mappings and lists', () => {
		const parsed = parseConfigYaml(
			[
				'sources:',
				'  npm: { enabled: true, paths: [package.json] }',
				'policy:',
				'  pr_label: "version-monitor"',
				'  pr_assignees: []',
				'  draft_pr: true',
			].join('\n')
		);
		expect(parsed.sources.npm).toEqual({
			enabled: true,
			paths: ['package.json'],
		});
		expect(parsed.policy).toEqual({
			pr_label: 'version-monitor',
			pr_assignees: [],
			draft_pr: true,
		});
	});

	it('ignores comments and blank lines', () => {
		const parsed = parseConfigYaml(
			[
				'# a comment',
				'',
				'sources:',
				'  npm: { enabled: false } # off',
			].join('\n')
		);
		expect(parsed.sources.npm).toEqual({ enabled: false });
	});
});

describe('loadConfig', () => {
	it('loads and normalises the sample config', () => {
		const config = loadConfig(FIXTURE_ROOT, 'version-monitor.yml');
		expect(config.sources.npm).toEqual({
			enabled: true,
			paths: ['package.json'],
		});
		expect(config.sources['wp-cli'].enabled).toBe(false);
		// All six sources present, even those omitted/disabled.
		expect(Object.keys(config.sources).sort()).toEqual(
			['actions', 'container', 'node', 'npm', 'php', 'wp-cli'].sort()
		);
		expect(config.policy.pr_label).toBe('version-monitor');
	});

	it('throws naming the path when the config is missing', () => {
		const missing = path.join(FIXTURE_ROOT, 'does-not-exist.yml');
		expect(() => loadConfig(FIXTURE_ROOT, 'does-not-exist.yml')).toThrow(
			missing
		);
	});
});

describe('validate', () => {
	it('defaults paths for an enabled source that omits them', () => {
		const config = validate(
			{ sources: { actions: { enabled: true } } },
			'cfg.yml'
		);
		expect(config.sources.actions.paths).toEqual([
			'.github/workflows/*.yml',
		]);
	});

	it('rejects an unknown source', () => {
		expect(() =>
			validate({ sources: { bogus: { enabled: true } } }, 'cfg.yml')
		).toThrow(/unknown source "bogus"/);
	});

	it('rejects a non-string paths entry', () => {
		expect(() =>
			validate(
				{ sources: { npm: { enabled: true, paths: [42] } } },
				'cfg.yml'
			)
		).toThrow(/invalid "paths"/);
	});

	it('rejects a missing sources mapping', () => {
		expect(() => validate({ policy: {} }, 'cfg.yml')).toThrow(
			/missing a "sources" mapping/
		);
	});
});

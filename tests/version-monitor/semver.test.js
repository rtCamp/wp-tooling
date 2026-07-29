'use strict';

const semver = require('../../src/version-monitor/semver');

describe('semver.splitVersion', () => {
	it('separates a range prefix from the numeric core', () => {
		expect(semver.splitVersion('^29.0.0')).toEqual({
			prefix: '^',
			core: '29.0.0',
		});
		expect(semver.splitVersion('>=8.1')).toEqual({
			prefix: '>=',
			core: '8.1',
		});
	});

	it('separates a v tag prefix', () => {
		expect(semver.splitVersion('v4.0.2')).toEqual({
			prefix: 'v',
			core: '4.0.2',
		});
	});

	it('returns an empty core for non-numeric specs', () => {
		expect(semver.splitVersion('*').core).toBe('');
		expect(semver.splitVersion('latest').core).toBe('');
	});
});

describe('semver.parse', () => {
	it('fills missing minor/patch with zero', () => {
		expect(semver.parse('8.1')).toMatchObject({
			major: 8,
			minor: 1,
			patch: 0,
		});
	});

	it('captures the pre-release tag', () => {
		expect(semver.parse('1.2.0-beta.1').prerelease).toBe('beta.1');
	});
});

describe('semver.compareStable / gt', () => {
	it('ranks by major, then minor, then patch', () => {
		expect(semver.compareStable('1.2.3', '1.2.4')).toBe(-1);
		expect(semver.compareStable('2.0.0', '1.9.9')).toBe(1);
		expect(semver.compareStable('1.2.3', '1.2.3')).toBe(0);
	});

	it('ignores prefixes and pre-release tags', () => {
		expect(semver.compareStable('v4.2.0', '^4.2.0')).toBe(0);
		expect(semver.gt('22.13.1', '22.11.0')).toBe(true);
		expect(semver.gt('22.11.0', '22.11.0')).toBe(false);
	});
});

describe('semver.isMajorBump', () => {
	it('is true only when the major increases', () => {
		expect(semver.isMajorBump('^29.0.0', '^30.4.1')).toBe(true);
		expect(semver.isMajorBump('4.0.2', '4.2.0')).toBe(false);
	});
});

describe('semver.isPreRelease', () => {
	it('detects pre-release suffixes', () => {
		expect(semver.isPreRelease('1.0.0-rc.1')).toBe(true);
		expect(semver.isPreRelease('1.0.0')).toBe(false);
	});
});

describe('semver.formatLatest', () => {
	it('re-attaches the current spec prefix to the latest core', () => {
		expect(semver.formatLatest('^29.0.0', '30.4.1')).toBe('^30.4.1');
		expect(semver.formatLatest('v4.0.2', 'v4.2.0')).toBe('v4.2.0');
		expect(semver.formatLatest('22.11.0', 'v22.13.1')).toBe('22.13.1');
		expect(semver.formatLatest('>=8.1', '8.3')).toBe('>=8.3');
	});
});

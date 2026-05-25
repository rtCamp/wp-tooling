'use strict';

const fs = require('fs');
const path = require('path');

const {
	changelog,
	rewriteChangelog,
	unreleasedHasContent,
	isoDate,
} = require('../../src/release/changelog');
const { copyFixture, cleanup } = require('./_helpers');

describe('release/changelog - pure helpers', () => {
	test('isoDate formats UTC date as YYYY-MM-DD', () => {
		expect(isoDate(new Date('2026-05-19T15:00:00Z'))).toBe('2026-05-19');
		expect(isoDate(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01');
	});

	test('unreleasedHasContent detects bullets', () => {
		const lines = [
			'## Unreleased',
			'',
			'### Added',
			'',
			'- A new thing.',
			'',
			'## 1.0.0',
		];
		expect(unreleasedHasContent(lines, 0)).toBe(true);
	});

	test('unreleasedHasContent detects plain paragraph content', () => {
		const lines = ['## Unreleased', '', 'Some prose.', '## 1.0.0'];
		expect(unreleasedHasContent(lines, 0)).toBe(true);
	});

	test('unreleasedHasContent rejects empty Unreleased', () => {
		const lines = ['## Unreleased', '', '## 1.0.0'];
		expect(unreleasedHasContent(lines, 0)).toBe(false);
	});

	test('unreleasedHasContent rejects subheadings without bullets', () => {
		const lines = [
			'## Unreleased',
			'',
			'### Added',
			'',
			'### Changed',
			'',
			'## 1.0.0',
		];
		expect(unreleasedHasContent(lines, 0)).toBe(false);
	});

	test('rewriteChangelog renames heading + prepends fresh Unreleased', () => {
		const before = [
			'# Changelog',
			'',
			'## Unreleased',
			'',
			'### Added',
			'',
			'- New widget.',
			'',
			'## 1.0.0 - 2026-01-01',
			'',
		].join('\n');
		const after = rewriteChangelog(before, '1.1.0', '2026-05-19');
		expect(after).toContain('## Unreleased\n\n## 1.1.0 - 2026-05-19');
		expect(after).toContain('- New widget.');
		expect(after).toContain('## 1.0.0 - 2026-01-01');
	});

	test('rewriteChangelog throws when Unreleased missing', () => {
		const body = '# Changelog\n\n## 1.0.0\n';
		expect(() => rewriteChangelog(body, '1.1.0', '2026-05-19')).toThrow(
			/no "## Unreleased"/
		);
	});

	test('rewriteChangelog throws when Unreleased is empty', () => {
		const body = '# Changelog\n\n## Unreleased\n\n## 1.0.0\n';
		expect(() => rewriteChangelog(body, '1.1.0', '2026-05-19')).toThrow(
			/is empty/
		);
	});
});

describe('release/changelog - integration against fixture', () => {
	let tmp;

	afterEach(() => {
		cleanup(tmp);
		tmp = null;
	});

	test('reads version from package.json by default', () => {
		tmp = copyFixture('plugin-a');
		const date = new Date('2026-05-20T00:00:00Z');
		const result = changelog({ cwd: tmp, date });
		expect(result.version).toBe('1.2.3');
		expect(result.date).toBe('2026-05-20');
		expect(result.file).toBe('CHANGELOG.md');
		const body = fs.readFileSync(path.join(tmp, 'CHANGELOG.md'), 'utf8');
		expect(body).toContain('## Unreleased\n\n## 1.2.3 - 2026-05-20');
	});

	test('--to overrides package.json version', () => {
		tmp = copyFixture('plugin-a');
		const date = new Date('2026-05-20T00:00:00Z');
		const result = changelog({ cwd: tmp, version: '9.9.9', date });
		expect(result.version).toBe('9.9.9');
		const body = fs.readFileSync(path.join(tmp, 'CHANGELOG.md'), 'utf8');
		expect(body).toContain('## 9.9.9 - 2026-05-20');
	});

	test('dryRun leaves CHANGELOG unchanged', () => {
		tmp = copyFixture('plugin-a');
		const before = fs.readFileSync(path.join(tmp, 'CHANGELOG.md'));
		const result = changelog({ cwd: tmp, dryRun: true });
		expect(result.dryRun).toBe(true);
		expect(fs.readFileSync(path.join(tmp, 'CHANGELOG.md'))).toEqual(before);
	});

	test('refuses to run when Unreleased is empty', () => {
		tmp = copyFixture('plugin-a');
		const body = [
			'# Changelog',
			'',
			'## Unreleased',
			'',
			'## 1.0.0 - 2026-01-01',
			'',
		].join('\n');
		fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), body);
		expect(() => changelog({ cwd: tmp })).toThrow(/is empty/);
	});

	test('throws when CHANGELOG.md is missing', () => {
		tmp = copyFixture('plugin-a');
		fs.unlinkSync(path.join(tmp, 'CHANGELOG.md'));
		expect(() => changelog({ cwd: tmp })).toThrow(/no CHANGELOG\.md/);
	});

	test('throws on malformed semver passed via --to', () => {
		tmp = copyFixture('plugin-a');
		expect(() => changelog({ cwd: tmp, version: '1.2' })).toThrow(
			/not a valid/
		);
	});
});

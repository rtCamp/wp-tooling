/**
 * Changelog finaliser.
 *
 * Renames the `## Unreleased` section to `## <version> - <YYYY-MM-DD>`
 * and prepends a fresh empty `## Unreleased` section at the top.
 *
 * Refuses to run when the existing `## Unreleased` section has no
 * content (only blank lines or empty `### Added` / `### Changed` /
 * `### Fixed` subheadings). Shipping a release with no notes is a
 * bug we want to catch at the CLI, not in code review.
 *
 * Designed to be invoked after `bump`: the new version is read from
 * `package.json` by default, or passed explicitly via `--to`. Date is
 * UTC so the file looks identical regardless of who runs the command.
 *
 * Zero runtime dependencies.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const UNRELEASED_HEADING_RE = /^## Unreleased\s*$/m;
const NEXT_LEVEL_TWO_HEADING_RE = /^## /;
const LEVEL_THREE_HEADING_RE = /^### /;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/**
 * Format a `Date` as `YYYY-MM-DD` in UTC.
 *
 * @param {Date} date Source date.
 * @return {string} ISO date string.
 */
function isoDate(date) {
	return date.toISOString().slice(0, 10);
}

/**
 * Has the `## Unreleased` section anything substantive between its
 * heading and the next `## ` heading (or EOF)?
 *
 * A line counts as content when it is non-blank AND not itself a
 * `### ...` subheading. Bullets, paragraphs, and inline code all count.
 *
 * @param {string[]} lines      File lines (already split).
 * @param {number}   headingIdx Index of the `## Unreleased` line.
 * @return {boolean} True when the section has substantive content.
 */
function unreleasedHasContent(lines, headingIdx) {
	for (let i = headingIdx + 1; i < lines.length; i++) {
		const line = lines[i];
		if (NEXT_LEVEL_TWO_HEADING_RE.test(line)) {
			return false;
		}
		if (line.trim() === '') {
			continue;
		}
		if (LEVEL_THREE_HEADING_RE.test(line)) {
			continue;
		}
		return true;
	}
	return false;
}

/**
 * Rewrite the changelog text. Pure -- no filesystem access. Returns the
 * new contents.
 *
 * @param {string} contents   Raw CHANGELOG.md.
 * @param {string} newVersion `X.Y.Z`.
 * @param {string} dateString `YYYY-MM-DD`.
 * @return {string} New contents.
 * @throws {Error} When `## Unreleased` is missing or empty.
 */
function rewriteChangelog(contents, newVersion, dateString) {
	const lines = contents.split('\n');
	let headingIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (UNRELEASED_HEADING_RE.test(lines[i])) {
			headingIdx = i;
			break;
		}
	}

	if (headingIdx === -1) {
		throw new Error(
			'release: CHANGELOG.md has no "## Unreleased" section to finalise'
		);
	}

	if (!unreleasedHasContent(lines, headingIdx)) {
		throw new Error(
			'release: "## Unreleased" section is empty -- add release notes before running release-changelog'
		);
	}

	const newHeading = `## ${newVersion} - ${dateString}`;
	const replacement = ['## Unreleased', '', newHeading];

	const before = lines.slice(0, headingIdx);
	const after = lines.slice(headingIdx + 1);

	return [...before, ...replacement, ...after].join('\n');
}

/**
 * Finalise the changelog on disk.
 *
 * `options.version` defaults to the version in `package.json` (run
 * `bump` first, then this). `options.date` defaults to "now" in UTC.
 *
 * @param {{ cwd?: string, version?: string|null, date?: Date, dryRun?: boolean }} options Run options.
 * @return {{ file: string, version: string, date: string, dryRun: boolean }} Summary.
 */
function changelog(options = {}) {
	const cwd = options.cwd || process.cwd();
	const dryRun = options.dryRun === true;
	const date = options.date instanceof Date ? options.date : new Date();
	const dateString = isoDate(date);

	let version = options.version || null;
	if (!version) {
		const packageJsonPath = path.join(cwd, 'package.json');
		if (!fs.existsSync(packageJsonPath)) {
			throw new Error(
				`release: no package.json at "${cwd}" and no --to version supplied`
			);
		}
		const packageJson = JSON.parse(
			fs.readFileSync(packageJsonPath, 'utf8')
		);
		if (typeof packageJson.version !== 'string' || !packageJson.version) {
			throw new Error(
				`release: package.json at "${cwd}" has no "version" field`
			);
		}
		version = packageJson.version;
	}

	if (!SEMVER_RE.test(version)) {
		throw new Error(
			`release: version "${version}" is not a valid X.Y.Z semver`
		);
	}

	const file = path.join(cwd, 'CHANGELOG.md');
	if (!fs.existsSync(file)) {
		throw new Error(`release: no CHANGELOG.md at "${cwd}"`);
	}

	const contents = fs.readFileSync(file, 'utf8');
	const next = rewriteChangelog(contents, version, dateString);

	if (!dryRun) {
		fs.writeFileSync(file, next);
	}

	return {
		file: path.relative(cwd, file),
		version,
		date: dateString,
		dryRun,
	};
}

module.exports = {
	changelog,
	rewriteChangelog,
	unreleasedHasContent,
	isoDate,
};

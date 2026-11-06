/**
 * Walk a project and match the iapi-check rules against each source file.
 * Nothing here writes anywhere; the only I/O is reading the tree.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { IapiCheckError } = require('./errors');
const { RULES, MARKUP_EXTENSIONS } = require('./rules');

/**
 * Directories never scanned, at any depth: dependencies, git metadata and
 * build output (`build/` also covers `assets/build/`). Built bundles repeat
 * what their sources already report.
 */
const SKIPPED_DIRS = new Set([
	'node_modules',
	'vendor',
	'.git',
	'build',
	'dist',
]);

/** Minified bundles: build output, and one line long. */
const MINIFIED_RE = /\.min\.[cm]?js$/i;

const SCANNED_EXTENSIONS = new Set(MARKUP_EXTENSIONS);

/**
 * Lower-cased extension without the dot: `Foo.PHP` → `php`.
 *
 * @param {string} file
 * @return {string} Extension, or `''`.
 */
function extensionOf(file) {
	return path.posix.extname(file).slice(1).toLowerCase();
}

/**
 * Offsets at which each line starts.
 *
 * @param {string} text
 * @return {number[]} `[0, ...]`, one entry per line.
 */
function lineStarts(text) {
	const starts = [0];
	for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
		starts.push(i + 1);
	}
	return starts;
}

/**
 * Turn an offset into a 1-based line and column.
 *
 * @param {number[]} starts lineStarts() result.
 * @param {number}   offset
 * @return {{line: number, column: number}} Position.
 */
function locate(starts, offset) {
	let low = 0;
	let high = starts.length - 1;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (starts[mid] <= offset) {
			low = mid;
		} else {
			high = mid - 1;
		}
	}
	return { line: low + 1, column: offset - starts[low] + 1 };
}

/**
 * Whether the text before a match, on its own line, puts it in a comment: the
 * line starts with `//`, `#` (not a PHP `#[attribute]`) or a `*` block-comment
 * continuation, or opens `/*` or `<!--` without closing it before the match.
 * A comment after code on the same line is not detected, so those matches are
 * still reported.
 *
 * @param {string} before Text from the start of the line to the match.
 * @return {boolean} True when the match is commented out.
 */
function isCommented(before) {
	const lead = before.trimStart();
	if (/^(?:\/\/|#(?!\[))/.test(lead)) {
		return true;
	}
	if (/^(?:\/?\*)/.test(lead)) {
		return !lead.includes('*/');
	}
	if (lead.startsWith('<!--')) {
		return !lead.includes('-->');
	}
	return false;
}

/**
 * Order findings by line, then column, then rule order.
 *
 * @param {Object} a
 * @param {Object} b
 * @return {number} Sort order.
 */
function byPosition(a, b) {
	return a.line - b.line || a.column - b.column;
}

/**
 * Match every rule that covers `file`'s extension against its text. Matches
 * on a commented-out line (see isCommented()) are skipped.
 *
 * @param {string} text Source text. A leading byte-order mark is not counted as a column.
 * @param {string} file Path to report (also picks the rules by extension).
 * @return {Object[]} Findings: `{ file, line, column, rule, severity, message, match, replacement }`, sorted by position.
 */
function scanText(text, file) {
	const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const ext = extensionOf(file);
	const findings = [];
	let starts = null;
	for (const rule of RULES) {
		if (
			!rule.extensions.includes(ext) ||
			(rule.appliesTo && !rule.appliesTo(body))
		) {
			continue;
		}
		const pattern = rule.patternFor ? rule.patternFor(body) : rule.pattern;
		for (const match of body.matchAll(pattern)) {
			starts ??= lineStarts(body);
			const { line } = locate(starts, match.index);
			if (isCommented(body.slice(starts[line - 1], match.index))) {
				continue;
			}
			const hit = rule.describe(match);
			findings.push({
				file,
				...locate(starts, hit.index),
				rule: rule.id,
				severity: rule.severity,
				message: hit.message,
				match: hit.text,
				replacement: hit.replacement,
			});
		}
	}
	return findings.sort(byPosition);
}

/**
 * Fail unless `root` is a readable directory.
 *
 * @param {string} root
 */
function assertDirectory(root) {
	let stat;
	try {
		stat = fs.statSync(root);
	} catch (err) {
		throw new IapiCheckError(
			`cannot read --working-dir "${root}" (${err.code || err.message}); expected an existing directory`
		);
	}
	if (!stat.isDirectory()) {
		throw new IapiCheckError(
			`--working-dir "${root}" is a file; expected a directory`
		);
	}
}

/**
 * Test `rel` against `pattern` from the start. A caller's RegExp with the `g`
 * or `y` flag keeps `lastIndex` between calls, which would make one file's
 * result depend on the previous file's.
 *
 * @param {RegExp} pattern
 * @param {string} rel
 * @return {boolean} Whether the path matches.
 */
function resetAndTest(pattern, rel) {
	pattern.lastIndex = 0;
	return pattern.test(rel);
}

/**
 * List the files to scan under `root`, relative to it with `/` separators and
 * sorted. Symbolic links are not followed.
 *
 * @param {string}      root
 * @param {RegExp|null} ignore Relative paths to skip.
 * @return {string[]} Relative paths.
 */
function listFiles(root, ignore) {
	const files = [];
	const pending = [''];
	while (pending.length > 0) {
		const dir = pending.pop();
		let entries;
		try {
			entries = fs.readdirSync(path.join(root, dir), {
				withFileTypes: true,
			});
		} catch (err) {
			throw new IapiCheckError(
				`cannot read directory "${path.join(root, dir)}" (${err.code || err.message})`
			);
		}
		for (const entry of entries) {
			const rel = dir ? `${dir}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (!SKIPPED_DIRS.has(entry.name)) {
					pending.push(rel);
				}
				continue;
			}
			if (
				entry.isFile() &&
				SCANNED_EXTENSIONS.has(extensionOf(entry.name)) &&
				!MINIFIED_RE.test(entry.name) &&
				!(ignore && resetAndTest(ignore, rel))
			) {
				files.push(rel);
			}
		}
	}
	return files.sort();
}

/**
 * Scan a project for Interactivity API usages WordPress 7.2 stops supporting.
 *
 * @param {Object}      options
 * @param {string}      options.root          Directory to scan.
 * @param {RegExp|null} [options.ignore=null] Skip files whose path relative to `root` matches.
 * @return {{filesScanned: number, findings: Object[], errors: number, warnings: number}} Findings sorted by file, then position.
 * @throws {IapiCheckError} When `root` or a file under it cannot be read.
 */
function checkIapi({ root, ignore = null }) {
	assertDirectory(root);
	const files = listFiles(root, ignore);
	const findings = [];
	for (const file of files) {
		let text;
		try {
			text = fs.readFileSync(path.join(root, file), 'utf8');
		} catch (err) {
			throw new IapiCheckError(
				`cannot read "${path.join(root, file)}" (${err.code || err.message})`
			);
		}
		for (const finding of scanText(text, file)) {
			findings.push(finding);
		}
	}
	const errors = findings.filter((f) => f.severity === 'error').length;
	return {
		filesScanned: files.length,
		findings,
		errors,
		warnings: findings.length - errors,
	};
}

module.exports = {
	checkIapi,
	scanText,
	SKIPPED_DIRS,
};

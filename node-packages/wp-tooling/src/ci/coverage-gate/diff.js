/**
 * Changed-line collection: which lines a pull request added or modified.
 *
 * Deliberately separate from `detect-changes`: that helper diffs two-dot
 * against a shallow-fetched base, falls back to `HEAD~1` on push, and treats a
 * git failure as "no changes". A gate needs the merge base, no push fallback,
 * and a loud failure — silent "no changes" would pass every PR.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');

const { GateError } = require('./errors');

const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

const HISTORY_HINT =
	'Coverage needs full history: check out with fetch-depth: 0 and make sure the base commit is present.';

/** `@@ -a[,b] +c[,d] @@` — `,d` is omitted for single-line hunks. */
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** C-style escapes Git uses in quoted paths, other than octal bytes. */
const GIT_ESCAPES = {
	a: '\x07',
	b: '\b',
	f: '\f',
	n: '\n',
	r: '\r',
	t: '\t',
	v: '\v',
	'"': '"',
	'\\': '\\',
};

/**
 * Unquote a path Git printed in C-style quotes (`"b/caf\303\251.php"`).
 *
 * @param {string} raw Path as printed after `+++ `.
 * @return {string} Unquoted path; unchanged when it wasn't quoted.
 */
function unquoteGitPath(raw) {
	if (!raw.startsWith('"') || !raw.endsWith('"')) {
		return raw;
	}
	const body = raw.slice(1, -1);
	const bytes = [];
	for (let i = 0; i < body.length; i++) {
		if (body[i] !== '\\') {
			bytes.push(...Buffer.from(body[i], 'utf8'));
			continue;
		}
		const octal = /^[0-7]{3}$/.exec(body.slice(i + 1, i + 4));
		if (octal) {
			bytes.push(parseInt(octal[0], 8));
			i += 3;
			continue;
		}
		const escaped = body[i + 1];
		bytes.push(...Buffer.from(GIT_ESCAPES[escaped] ?? escaped, 'utf8'));
		i++;
	}
	return Buffer.from(bytes).toString('utf8');
}

/**
 * Get (or create) the line set for the file named by a `+++ ` header.
 *
 * @param {Map<string, Set<number>>} changed
 * @param {string}                   header  The full `+++ b/<path>` line.
 * @return {Set<number>|null} The file's line set, or `null` for `/dev/null` (a deletion).
 */
function startFile(changed, header) {
	// Git appends a tab to a path containing a space; strip only that, so a
	// name that really ends in a space survives.
	const target = unquoteGitPath(header.slice(4).replace(/\t$/, ''));
	if (target === '/dev/null') {
		return null;
	}
	const file = target.replace(/^b\//, '');
	if (!changed.has(file)) {
		changed.set(file, new Set());
	}
	return changed.get(file);
}

/**
 * Add a hunk's post-image line range to a file's line set.
 *
 * @param {Set<number>} fileLines
 * @param {string[]}    hunk      HUNK_RE match: `[1]` start, `[2]` optional count.
 */
function addHunkLines(fileLines, hunk) {
	const start = Number(hunk[1]);
	const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
	for (let lineNo = start; lineNo < start + count; lineNo++) {
		fileLines.add(lineNo);
	}
}

/**
 * Parse `git diff --unified=0` output into the lines each file added or modified.
 *
 * `+++ ` is only a file header between `diff --git` and the first `@@`; inside
 * a hunk it is an added line whose content starts with `++ `. Deleted lines
 * never appear: a `+c,0` hunk (pure deletion) contributes nothing.
 *
 * @param {string} diffText Raw diff output.
 * @return {Map<string, Set<number>>} Post-image path → changed line numbers.
 */
function parseDiffHunks(diffText) {
	const changed = new Map();
	let fileLines = null;
	let inHeader = false;
	for (const line of diffText.split(/\r?\n/)) {
		if (line.startsWith('diff --git ')) {
			inHeader = true;
			fileLines = null;
			continue;
		}
		if (inHeader && line.startsWith('+++ ')) {
			fileLines = startFile(changed, line);
			continue;
		}
		const hunk = HUNK_RE.exec(line);
		if (!hunk) {
			continue;
		}
		inHeader = false;
		if (fileLines) {
			addHunkLines(fileLines, hunk);
		}
	}
	for (const [file, lines] of changed) {
		if (lines.size === 0) {
			changed.delete(file);
		}
	}
	return changed;
}

/**
 * Run a git command in `cwd`, turning failures into a GateError.
 *
 * `core.quotePath=false` is set on every call so `args[0]` is always the
 * subcommand, which the error message names.
 *
 * @param {string[]} args   Subcommand and its arguments.
 * @param {string}   cwd    Working directory.
 * @param {string}   [hint] Guidance appended to the error message.
 * @return {string} stdout.
 */
function git(args, cwd, hint = '') {
	try {
		return execFileSync(
			'git',
			['-C', cwd, '-c', 'core.quotePath=false', ...args],
			{
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
				maxBuffer: MAX_GIT_OUTPUT_BYTES,
			}
		);
	} catch (err) {
		const detail = (err.stderr || err.message || '').toString().trim();
		const suffix = hint ? ` ${hint}` : '';
		throw new GateError(`git ${args[0]} failed (${detail}).${suffix}`);
	}
}

/**
 * Collect lines added or modified between the merge base of `base` and HEAD.
 *
 * Paths come back relative to `cwd` and are limited to it (`--relative`).
 * Renames are detected explicitly (`--find-renames`, whatever the user's
 * `diff.renames` config) and kept (`R`), so a moved-and-edited file reports
 * only its edits. Only committed work counts: uncommitted changes are not in
 * `base...HEAD`.
 *
 * @param {Object} options
 * @param {string} options.base Git ref or SHA to diff against.
 * @param {string} options.cwd  Directory to scope the diff to.
 * @return {Map<string, Set<number>>} Path → changed line numbers.
 */
function gitChangedLines({ base, cwd }) {
	git(
		['rev-parse', '--verify', '--quiet', `${base}^{commit}`],
		cwd,
		HISTORY_HINT
	);
	const diff = git(
		[
			'diff',
			'--unified=0',
			'--find-renames',
			'--diff-filter=AMR',
			'--relative',
			'--no-color',
			'--no-ext-diff',
			'--src-prefix=a/',
			'--dst-prefix=b/',
			`${base}...HEAD`,
		],
		cwd,
		HISTORY_HINT
	);
	return parseDiffHunks(diff);
}

/**
 * The working dir's path relative to the repo root, e.g. `''` or `plugins/acme/`.
 *
 * @param {string} cwd
 * @return {string} Prefix with a trailing slash, or `''` at the root.
 */
function repoPrefix(cwd) {
	return git(['rev-parse', '--show-prefix'], cwd).trim();
}

/**
 * Read the base SHA from the GitHub event payload, if there is one.
 *
 * @param {string|undefined} eventPath `$GITHUB_EVENT_PATH`.
 * @return {string|null} `pull_request.base.sha` or `merge_group.base_sha`.
 */
function readEventBaseSha(eventPath) {
	if (!eventPath) {
		return null;
	}
	try {
		const payload = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
		const sha =
			payload?.pull_request?.base?.sha || payload?.merge_group?.base_sha;
		return typeof sha === 'string' && /^[0-9a-f]{7,64}$/i.test(sha)
			? sha
			: null;
	} catch {
		return null;
	}
}

/**
 * Work out which ref to diff against.
 *
 * Order: explicit `--base`, then the pull request (or merge queue) base SHA
 * from `$GITHUB_EVENT_PATH`, then `origin/$GITHUB_BASE_REF`. Anything else —
 * a push, a schedule, a local run without `--base` — has no base: `null`.
 *
 * @param {Object} [options]
 * @param {string} [options.base] Explicit ref.
 * @param {Object} [options.env]  Environment (defaults to `process.env`).
 * @return {string|null} Ref to diff against, or `null` when there is none.
 */
function resolveGateBase({ base, env = process.env } = {}) {
	if (base) {
		return base;
	}
	const eventSha = readEventBaseSha(env.GITHUB_EVENT_PATH);
	if (eventSha) {
		return eventSha;
	}
	return env.GITHUB_BASE_REF ? `origin/${env.GITHUB_BASE_REF}` : null;
}

module.exports = {
	parseDiffHunks,
	gitChangedLines,
	repoPrefix,
	resolveGateBase,
};

/**
 * GitHub Actions detector -- finds newer releases of the actions pinned in
 * each workflow YAML the config points at.
 *
 * Scans `uses: owner/repo[/path]@ref` lines, skipping local (`./...`) and
 * Docker (`docker://...`) references and refs that are not version tags
 * (branch names, commit SHAs). Looks up the latest release tag per action via
 * the GitHub API, authenticating with `GITHUB_TOKEN` when present to lift the
 * unauthenticated 60/hour rate limit.
 *
 * Zero runtime dependencies -- Node built-ins via the shared `http` helper.
 */

'use strict';

const { getJson, isClientError } = require('../http');
const semver = require('../semver');
const { expandPaths, readFileSafe, recordError } = require('../util');

/** Matches `uses: <ref>` capturing the reference token. */
const USES_RE = /(?:^|\s)uses:\s*['"]?([^\s'"#]+)/gm;

/**
 * Extract the distinct `owner/repo[/path]@ref` references from a workflow.
 *
 * @param {string} text Workflow file contents.
 * @return {Array<{action: string, ref: string, owner: string, repo: string}>} Parsed, version-tagged references.
 */
function parseUses(text) {
	const seen = new Set();
	const out = [];
	let match;
	while ((match = USES_RE.exec(text)) !== null) {
		const raw = match[1];
		if (raw.startsWith('./') || raw.startsWith('docker://')) {
			continue;
		}
		const at = raw.lastIndexOf('@');
		if (at === -1) {
			continue;
		}
		const action = raw.slice(0, at);
		const ref = raw.slice(at + 1);
		const segments = action.split('/');
		if (segments.length < 2) {
			continue;
		}
		// Only fully-qualified version tags are comparable; skip branch names,
		// SHA pins, and deliberate floating-major tags (`@v4`).
		if (!semver.splitVersion(ref).core.includes('.')) {
			continue;
		}
		const key = `${action}@${ref}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push({ action, ref, owner: segments[0], repo: segments[1] });
	}
	return out;
}

/**
 * Fetch the latest release tag for a repository.
 *
 * @param {string} owner   Repository owner.
 * @param {string} repo    Repository name.
 * @param {string} [token] Optional GitHub token.
 * @return {Promise<string|undefined>} The `tag_name`, or `undefined`.
 */
async function fetchLatestTag(owner, repo, token) {
	const data = await getJson(
		`https://api.github.com/repos/${owner}/${repo}/releases/latest`,
		{ token, headers: { Accept: 'application/vnd.github+json' } }
	);
	return data && data.tag_name;
}

/**
 * Detect GitHub Actions updates.
 *
 * @param {Object} config        Normalised config.
 * @param {Object} [options]
 * @param {string} [options.cwd] Project root.
 * @return {Promise<Object[]>} Update records.
 */
async function detect(config, options = {}) {
	const cwd = options.cwd || process.cwd();
	const token = process.env.GITHUB_TOKEN;
	const updates = [];
	const files = expandPaths(cwd, config.sources.actions.paths);

	for (const file of files) {
		const text = readFileSafe(cwd, file);
		if (text === null) {
			continue;
		}
		for (const { action, ref, owner, repo } of parseUses(text)) {
			let tag;
			try {
				tag = await fetchLatestTag(owner, repo, token);
			} catch (err) {
				process.stderr.write(
					`version-monitor: actions lookup for "${action}" failed: ${err.message}\n`
				);
				if (err.rateLimited) {
					return updates;
				}
				// A 404 just means the repo publishes no GitHub releases.
				if (!isClientError(err)) {
					recordError(options, `actions "${action}": ${err.message}`);
				}
				continue;
			}
			if (!tag || semver.isPreRelease(tag)) {
				continue;
			}
			if (!semver.gt(tag, ref)) {
				continue;
			}
			updates.push({
				source: 'actions',
				file,
				package: action,
				currentValue: ref,
				latestValue: semver.formatLatest(ref, tag),
				reason: 'newer-release',
			});
		}
	}

	return updates;
}

module.exports = { detect, parseUses };

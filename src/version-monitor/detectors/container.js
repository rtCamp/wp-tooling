/**
 * Container detector -- compares base-image tags in `Dockerfile`s and
 * `devcontainer.json` against the tags published on Docker Hub.
 *
 * Handles Docker Hub images only (official `library/*` and `org/name`); images
 * from other registries (`ghcr.io/...`), digest-pinned references, and tags
 * without a `major.minor` shape are skipped. Candidate tags are restricted to
 * the same numeric shape as the current tag so variant tags (`-alpine`,
 * `bookworm`, `latest`) never masquerade as upgrades.
 *
 * Zero runtime dependencies -- Node built-ins via the shared `http` helper.
 */

'use strict';

const path = require('path');
const { getJson, isClientError } = require('../http');
const semver = require('../semver');
const {
	expandPaths,
	readFileSafe,
	readJsonSafe,
	recordError,
} = require('../util');

/** Matches `FROM [--flag[=val]]... <ref>` lines, skipping leading flags like `--platform`. */
const FROM_RE = /^\s*FROM\s+(?:--\S+\s+)*(\S+)/gim;

/**
 * Split an image reference into `{ image, tag }`, or `null` when it carries no
 * usable tag (digest-pinned or untagged).
 *
 * @param {string} ref Image reference.
 * @return {{image: string, tag: string}|null} Parsed reference.
 */
function splitImageTag(ref) {
	if (ref.includes('@')) {
		return null;
	}
	const lastColon = ref.lastIndexOf(':');
	const lastSlash = ref.lastIndexOf('/');
	if (lastColon === -1 || lastColon < lastSlash) {
		return null;
	}
	return { image: ref.slice(0, lastColon), tag: ref.slice(lastColon + 1) };
}

/**
 * Resolve an image name to its Docker Hub repository path, or `null` for
 * non-Docker-Hub registries.
 *
 * @param {string} image Image name (no tag).
 * @return {string|null} Hub repository path.
 */
function hubRepo(image) {
	if (image.includes('/')) {
		const firstSegment = image.split('/')[0];
		if (firstSegment.includes('.') || firstSegment.includes(':')) {
			return null;
		}
		return image;
	}
	return `library/${image}`;
}

/**
 * Pick the newest tag matching the current tag's numeric shape.
 *
 * @param {string[]} tags       Available tag names.
 * @param {string}   currentTag The current tag.
 * @return {string|undefined} Newest matching tag, or `undefined`.
 */
function pickLatestTag(tags, currentTag) {
	const segments = currentTag.split('.').length;
	const shape = new RegExp(`^\\d+${'\\.\\d+'.repeat(segments - 1)}$`);
	const candidates = tags.filter(
		(t) => shape.test(t) && !semver.isPreRelease(t)
	);
	if (candidates.length === 0) {
		return undefined;
	}
	return candidates.reduce((best, t) => (semver.gt(t, best) ? t : best));
}

/**
 * Gather base-image pins from the configured files.
 *
 * @param {string}   cwd   Project root.
 * @param {string[]} files Resolved cwd-relative paths.
 * @return {Array<{file: string, image: string, tag: string}>} Distinct pins.
 */
function collectPins(cwd, files) {
	const pins = [];
	const seen = new Set();
	const add = (file, ref) => {
		const parsed = splitImageTag(ref);
		if (!parsed || !parsed.tag.includes('.')) {
			return;
		}
		const key = `${file}::${ref}`;
		if (!seen.has(key)) {
			seen.add(key);
			pins.push({ file, image: parsed.image, tag: parsed.tag });
		}
	};

	for (const file of files) {
		const base = path.posix.basename(file);
		if (base === 'devcontainer.json' || file.endsWith('.json')) {
			const json = readJsonSafe(cwd, file);
			if (json && typeof json.image === 'string') {
				add(file, json.image);
			}
			continue;
		}
		const text = readFileSafe(cwd, file);
		if (text === null) {
			continue;
		}
		let match;
		while ((match = FROM_RE.exec(text)) !== null) {
			add(file, match[1]);
		}
	}
	return pins;
}

/**
 * Detect container base-image updates.
 *
 * @param {Object} config        Normalised config.
 * @param {Object} [options]
 * @param {string} [options.cwd] Project root.
 * @return {Promise<Object[]>} Update records.
 */
async function detect(config, options = {}) {
	const cwd = options.cwd || process.cwd();
	const files = expandPaths(cwd, config.sources.container.paths);
	const pins = collectPins(cwd, files);
	const tagCache = new Map();
	const updates = [];

	for (const { file, image, tag } of pins) {
		const repo = hubRepo(image);
		if (!repo) {
			continue;
		}
		if (!tagCache.has(repo)) {
			try {
				const data = await getJson(
					`https://hub.docker.com/v2/repositories/${repo}/tags?page_size=100`
				);
				const names = Array.isArray(data && data.results)
					? data.results.map((r) => r && r.name).filter(Boolean)
					: [];
				tagCache.set(repo, names);
			} catch (err) {
				process.stderr.write(
					`version-monitor: container lookup for "${image}" failed: ${err.message}\n`
				);
				if (!err.rateLimited && !isClientError(err)) {
					recordError(
						options,
						`container "${image}": ${err.message}`
					);
				}
				tagCache.set(repo, []);
			}
		}
		const latest = pickLatestTag(tagCache.get(repo), tag);
		if (!latest || !semver.gt(latest, tag)) {
			continue;
		}
		updates.push({
			source: 'container',
			file,
			package: image,
			currentValue: tag,
			latestValue: semver.formatLatest(tag, latest),
			reason: 'newer-image',
		});
	}
	return updates;
}

module.exports = {
	detect,
	collectPins,
	splitImageTag,
	hubRepo,
	pickLatestTag,
};

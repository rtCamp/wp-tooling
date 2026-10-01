/**
 * `.distignore`-aware plugin packager.
 *
 * Walks the project directory, applies the ignore patterns from
 * `.distignore` (or a sensible default exclude list), and writes a
 * deterministic `dist/<slug>-<version>.zip` containing the slug-named
 * top-level directory.
 *
 * "Deterministic" means: entries sorted lexicographically, mtimes
 * pinned to a single epoch, exec bits zeroed except for files that
 * were already executable on disk. Two consecutive runs against the
 * same tree produce a byte-identical archive.
 *
 * The mtime epoch is resolved in this precedence order:
 *
 *   1. explicit `options.epoch`
 *   2. `SOURCE_DATE_EPOCH` env var (standard reproducible-build hook)
 *   3. `git log -1 --format=%ct HEAD` (the working tree's commit time)
 *   4. fallback: 315532800 (2010-01-01 00:00:00 UTC)
 *
 * Zero runtime dependencies. The zip is written using a small
 * hand-rolled writer (`zipPack`) on top of `zlib.deflateRawSync`.
 *
 * Format reference: APPNOTE.TXT (PKZIP). The subset we emit covers
 * local file headers, central directory records and the end-of-central-
 * directory record. ZIP64 is not needed at our scale (plugin packages
 * comfortably under 4 GB / 65k files).
 */

/* eslint-disable no-bitwise -- ZIP encoding and CRC-32 are bit-level
   operations by definition (see APPNOTE.TXT and ISO/IEC CRC-32 spec). */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const { loadContext } = require('./context');

const FALLBACK_EPOCH = 315532800; // 2010-01-01 00:00:00 UTC

const DEFAULT_IGNORE_PATTERNS = [
	'tests/',
	'node_modules/',
	'bin/',
	'.github/',
	'*.config.js',
	'package-lock.json',
];

const ALWAYS_EXCLUDE = new Set(['.git', 'dist']);

// Uncompressed payload above which a build is almost certainly shipping
// something it should not. A production plugin -- code, assets, and the
// no-dev vendor tree -- lands well under this; a vendor/ with dev requirements
// in it (PHPUnit, PHP_CodeSniffer, the WordPress stubs) lands orders of
// magnitude over. WordPress.org itself refuses uploads far smaller than this.
const SIZE_WARN_BYTES = 25 * 1024 * 1024;

/**
 * Flag a payload that is too big to be a real release.
 *
 * `vendor/` is deliberately not in DEFAULT_IGNORE_PATTERNS: a plugin that
 * autoloads its Composer dependencies has to ship it, so excluding it by
 * default would quietly produce a broken plugin. The failure worth catching is
 * the opposite one -- shipping a vendor tree that still has dev requirements
 * installed -- and that shows up as size, which is what this reports.
 *
 * @param {Array<{relPath: string, size: number}>} files Files that would ship.
 * @return {string[]} Warnings, empty when the payload is a sane size.
 */
function sizeWarnings(files) {
	const total = files.reduce((sum, f) => sum + (f.size || 0), 0);
	if (total <= SIZE_WARN_BYTES) {
		return [];
	}

	// Attribute the bulk to top-level directories, which is the granularity a
	// .distignore entry works at.
	const byTop = new Map();
	for (const f of files) {
		const top = f.relPath.split('/')[0];
		byTop.set(top, (byTop.get(top) || 0) + (f.size || 0));
	}
	const biggest = [...byTop.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([name, bytes]) => `${name} (${formatBytes(bytes)})`)
		.join(', ');

	return [
		`archive payload is ${formatBytes(total)} across ${files.length} files, which is far larger than a release should be. Largest: ${biggest}.`,
		'If vendor/ is listed above, run `composer install --no-dev` before building, or exclude what you do not ship in .distignore.',
	];
}

/**
 * Render a byte count for a human.
 *
 * @param {number} bytes Byte count.
 * @return {string} e.g. `2.3 GB`.
 */
function formatBytes(bytes) {
	const units = ['B', 'KB', 'MB', 'GB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/* -------------------------------------------------------------------------- */
/*  CRC-32                                                                    */
/* -------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[i] = c >>> 0;
	}
	return table;
})();

/**
 * Standard CRC-32 (polynomial 0xEDB88320).
 *
 * @param {Buffer} buf Input bytes.
 * @return {number} Unsigned 32-bit CRC.
 */
function crc32(buf) {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

/* -------------------------------------------------------------------------- */
/*  DOS time / date                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Convert a Unix epoch to DOS time + date (two 16-bit fields). DOS time
 * has 2-second resolution; DOS date is anchored to 1980.
 *
 * @param {number} epochSeconds Unix epoch seconds.
 * @return {{ time: number, date: number }} DOS-encoded fields.
 */
function dosTimeDate(epochSeconds) {
	const d = new Date(epochSeconds * 1000);
	const year = d.getUTCFullYear();
	const month = d.getUTCMonth() + 1;
	const day = d.getUTCDate();
	const hours = d.getUTCHours();
	const minutes = d.getUTCMinutes();
	const seconds = d.getUTCSeconds();
	const safeYear = Math.max(1980, year);
	return {
		time: (hours << 11) | (minutes << 5) | (seconds >> 1),
		date: ((safeYear - 1980) << 9) | (month << 5) | day,
	};
}

/* -------------------------------------------------------------------------- */
/*  ZIP writer                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Single entry passed to `zipPack`.
 *
 * @typedef  {Object}  ZipEntry
 * @property {string}  name       Forward-slash path inside the zip.
 * @property {Buffer}  data       Raw file bytes.
 * @property {number}  mtimeEpoch Unix epoch seconds (pinned for determinism).
 * @property {boolean} executable Sets 0755 vs 0644 in external attributes.
 */

/**
 * Pack a list of entries into a ZIP archive. Each entry must already be
 * sorted in the order the caller wants them stored -- the writer does
 * not re-sort.
 *
 * @param {ZipEntry[]} entries Sorted entries to include.
 * @return {Buffer} Complete archive.
 */
function zipPack(entries) {
	const localChunks = [];
	const centralChunks = [];
	let offset = 0;
	let entryCount = 0;

	for (const entry of entries) {
		const nameBytes = Buffer.from(entry.name, 'utf8');
		const crc = crc32(entry.data);
		const compressed = zlib.deflateRawSync(entry.data);
		const { time, date } = dosTimeDate(entry.mtimeEpoch);
		// Bit 11 of the general-purpose flag advertises UTF-8 names; we
		// always emit UTF-8.
		const flag = 0x0800;
		// Method 8 = DEFLATE.
		const method = 8;
		const externalAttr =
			((entry.executable ? 0o100755 : 0o100644) & 0xffff) << 16;

		const local = Buffer.alloc(30 + nameBytes.length);
		local.writeUInt32LE(0x04034b50, 0); // local file header signature
		local.writeUInt16LE(20, 4); // version needed (2.0)
		local.writeUInt16LE(flag, 6);
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(time, 10);
		local.writeUInt16LE(date, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		local.writeUInt16LE(0, 28); // extra field length
		nameBytes.copy(local, 30);

		localChunks.push(local, compressed);

		const central = Buffer.alloc(46 + nameBytes.length);
		central.writeUInt32LE(0x02014b50, 0); // central directory header signature
		central.writeUInt16LE(0x031e, 4); // version made by (Unix, 3.0)
		central.writeUInt16LE(20, 6); // version needed
		central.writeUInt16LE(flag, 8);
		central.writeUInt16LE(method, 10);
		central.writeUInt16LE(time, 12);
		central.writeUInt16LE(date, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(entry.data.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt16LE(0, 30); // extra field length
		central.writeUInt16LE(0, 32); // comment length
		central.writeUInt16LE(0, 34); // disk number start
		central.writeUInt16LE(0, 36); // internal file attributes
		central.writeUInt32LE(externalAttr >>> 0, 38);
		central.writeUInt32LE(offset, 42); // local header offset
		nameBytes.copy(central, 46);

		centralChunks.push(central);

		offset += local.length + compressed.length;
		entryCount += 1;
	}

	const centralSize = centralChunks.reduce((s, c) => s + c.length, 0);
	const centralOffset = offset;

	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
	end.writeUInt16LE(0, 4); // this disk number
	end.writeUInt16LE(0, 6); // disk with central directory
	end.writeUInt16LE(entryCount, 8); // entries on this disk
	end.writeUInt16LE(entryCount, 10); // total entries
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(centralOffset, 16);
	end.writeUInt16LE(0, 20); // comment length

	return Buffer.concat([...localChunks, ...centralChunks, end]);
}

/* -------------------------------------------------------------------------- */
/*  Ignore patterns                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Compile a single `.distignore` line into a matcher.
 *
 * Supports:
 *   - `#` comments and blank lines (returned matcher is `null`)
 *   - `*`  matches any run of characters except `/`
 *   - `**` matches any run of characters including `/`
 *   - trailing `/` forces directory-only match
 *   - patterns without a leading `/` match at any depth
 *
 * @param {string} raw Raw line.
 * @return {{ regex: RegExp, dirOnly: boolean }|null} Compiled matcher, or `null` for comments and blanks.
 */
function compileIgnorePattern(raw) {
	const trimmed = raw.replace(/\r$/, '').trim();
	if (!trimmed || trimmed.startsWith('#')) {
		return null;
	}
	let pattern = trimmed;
	const dirOnly = pattern.endsWith('/');
	if (dirOnly) {
		pattern = pattern.slice(0, -1);
	}
	const anchored = pattern.startsWith('/');
	if (anchored) {
		pattern = pattern.slice(1);
	}
	let re = '';
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i];
		if (ch === '*') {
			if (pattern[i + 1] === '*') {
				re += '.*';
				i += 1;
			} else {
				re += '[^/]*';
			}
		} else if (ch === '?') {
			re += '[^/]';
		} else if (/[.+^${}()|[\]\\]/.test(ch)) {
			re += `\\${ch}`;
		} else {
			re += ch;
		}
	}
	const prefix = anchored ? '^' : '^(.*/)?';
	const suffix = '(/.*)?$';
	return { regex: new RegExp(`${prefix}${re}${suffix}`), dirOnly };
}

/**
 * Load and compile ignore patterns. Falls back to the default exclude
 * list when no `.distignore` exists.
 *
 * @param {string} cwd Project root.
 * @return {{ regex: RegExp, dirOnly: boolean }[]} Compiled matchers.
 */
function loadIgnorePatterns(cwd) {
	const file = path.join(cwd, '.distignore');
	const lines = fs.existsSync(file)
		? fs.readFileSync(file, 'utf8').split('\n')
		: DEFAULT_IGNORE_PATTERNS;
	const out = [];
	for (const line of lines) {
		const compiled = compileIgnorePattern(line);
		if (compiled) {
			out.push(compiled);
		}
	}
	return out;
}

/**
 * Test a relative path against the compiled ignore list.
 *
 * @param {string}                                relPath
 * @param {boolean}                               isDirectory
 * @param {{ regex: RegExp, dirOnly: boolean }[]} patterns
 * @return {boolean} True if the path is excluded from the archive.
 */
function isIgnored(relPath, isDirectory, patterns) {
	for (const p of patterns) {
		if (p.dirOnly && !isDirectory) {
			continue;
		}
		if (p.regex.test(relPath)) {
			return true;
		}
	}
	return false;
}

/* -------------------------------------------------------------------------- */
/*  Walk + epoch + driver                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Walk `root` recursively, returning a sorted list of files that pass
 * the ignore list. Directories are never returned (extractors create
 * them implicitly from file paths). `.git/` and `dist/` are always
 * excluded.
 *
 * @param {string}                                root     Project root.
 * @param {{ regex: RegExp, dirOnly: boolean }[]} patterns Compiled ignore matchers.
 * @return {{ relPath: string, absPath: string, executable: boolean }[]} Sorted file list.
 */
function walkProject(root, patterns) {
	const out = [];

	function visit(dir, prefix) {
		let entries;
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			if (prefix === '' && ALWAYS_EXCLUDE.has(entry.name)) {
				continue;
			}
			const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
			const absPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (isIgnored(relPath, true, patterns)) {
					continue;
				}
				visit(absPath, relPath);
			} else if (entry.isFile()) {
				if (isIgnored(relPath, false, patterns)) {
					continue;
				}
				let executable = false;
				let size = 0;
				try {
					const st = fs.statSync(absPath);
					executable = (st.mode & 0o111) !== 0;
					size = st.size;
				} catch {
					executable = false;
				}
				out.push({ relPath, absPath, executable, size });
			}
		}
	}

	visit(root, '');
	return out;
}

/**
 * Resolve the pinned epoch for entry mtimes.
 *
 * @param {string}             cwd     Project root (passed to `git log`).
 * @param {{ epoch?: number }} options Optional explicit override.
 * @return {number} Unix epoch seconds.
 */
function resolveEpoch(cwd, options) {
	if (typeof options.epoch === 'number') {
		return options.epoch;
	}
	if (process.env.SOURCE_DATE_EPOCH) {
		const parsed = parseInt(process.env.SOURCE_DATE_EPOCH, 10);
		if (!Number.isNaN(parsed)) {
			return parsed;
		}
	}
	try {
		const stdout = execFileSync(
			'git',
			['log', '-1', '--format=%ct', 'HEAD'],
			{ cwd, stdio: ['ignore', 'pipe', 'ignore'] }
		)
			.toString()
			.trim();
		const parsed = parseInt(stdout, 10);
		if (!Number.isNaN(parsed)) {
			return parsed;
		}
	} catch {
		// not in a git repo, or git not available -- fall through
	}
	return FALLBACK_EPOCH;
}

/**
 * Build the zip plan (list of entries) without writing anything.
 *
 * @param {{ cwd?: string, epoch?: number }} options Plan options.
 * @return {Object} Plan describing slug, version, epoch, files, output path, warnings.
 */
function plan(options = {}) {
	const cwd = options.cwd || process.cwd();
	const ctx = loadContext(cwd);
	const patterns = loadIgnorePatterns(cwd);
	const files = walkProject(cwd, patterns);
	const epoch = resolveEpoch(cwd, options);
	const outputPath = path.join(
		cwd,
		'dist',
		`${ctx.pluginSlug}-${ctx.currentVersion}.zip`
	);
	return {
		slug: ctx.pluginSlug,
		version: ctx.currentVersion,
		epoch,
		files,
		excludedSample: [],
		outputPath,
		warnings: sizeWarnings(files),
	};
}

/**
 * Build and write the zip.
 *
 * @param {{ cwd?: string, force?: boolean, dryRun?: boolean, epoch?: number }} options Run options.
 * @return {Object} Summary with outputPath, slug, version, fileCount, byteSize, warnings, dryRun.
 */
function zip(options = {}) {
	const cwd = options.cwd || process.cwd();
	const force = options.force === true;
	const dryRun = options.dryRun === true;
	const p = plan({ cwd, epoch: options.epoch });

	if (!force && fs.existsSync(p.outputPath)) {
		throw new Error(
			`release: ${path.relative(cwd, p.outputPath)} already exists (re-run with --force to overwrite)`
		);
	}

	const entries = p.files.map((f) => ({
		name: `${p.slug}/${f.relPath}`,
		data: fs.readFileSync(f.absPath),
		mtimeEpoch: p.epoch,
		executable: f.executable,
	}));

	const archive = zipPack(entries);

	if (!dryRun) {
		fs.mkdirSync(path.dirname(p.outputPath), { recursive: true });
		fs.writeFileSync(p.outputPath, archive);
	}

	return {
		outputPath: path.relative(cwd, p.outputPath),
		slug: p.slug,
		version: p.version,
		fileCount: entries.length,
		byteSize: archive.length,
		warnings: p.warnings,
		dryRun,
	};
}

module.exports = {
	zip,
	plan,
	zipPack,
	crc32,
	dosTimeDate,
	compileIgnorePattern,
	loadIgnorePatterns,
	walkProject,
	resolveEpoch,
	DEFAULT_IGNORE_PATTERNS,
	FALLBACK_EPOCH,
};

/* eslint-enable no-bitwise */

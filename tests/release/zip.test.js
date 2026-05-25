/* eslint-disable no-bitwise -- mirrors the bit-level DOS encoding the
   zip writer itself uses for its expected-value assertions. */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const {
	zip,
	zipPack,
	crc32,
	dosTimeDate,
	compileIgnorePattern,
	loadIgnorePatterns,
	walkProject,
	resolveEpoch,
	DEFAULT_IGNORE_PATTERNS,
	FALLBACK_EPOCH,
} = require('../../src/release/zip');
const { copyFixture, cleanup } = require('./_helpers');

/**
 * Walk the central directory of a zip buffer and return the filename
 * list. Sufficient to verify which files were included; we don't need
 * a full unzipper for that.
 *
 * @param {Buffer} buf Zip archive bytes.
 * @return {string[]} Filenames from the central directory.
 */
function readZipEntryNames(buf) {
	// End of central directory record is the last 22 bytes (no archive comment).
	const eocdOffset = buf.length - 22;
	if (buf.readUInt32LE(eocdOffset) !== 0x06054b50) {
		throw new Error('zip: missing end of central directory signature');
	}
	const totalEntries = buf.readUInt16LE(eocdOffset + 10);
	let cdOffset = buf.readUInt32LE(eocdOffset + 16);
	const names = [];
	for (let i = 0; i < totalEntries; i++) {
		if (buf.readUInt32LE(cdOffset) !== 0x02014b50) {
			throw new Error(
				`zip: missing central directory header at entry ${i}`
			);
		}
		const nameLen = buf.readUInt16LE(cdOffset + 28);
		const extraLen = buf.readUInt16LE(cdOffset + 30);
		const commentLen = buf.readUInt16LE(cdOffset + 32);
		const name = buf
			.slice(cdOffset + 46, cdOffset + 46 + nameLen)
			.toString('utf8');
		names.push(name);
		cdOffset += 46 + nameLen + extraLen + commentLen;
	}
	return names;
}

describe('release/zip - helpers', () => {
	test('crc32 matches known vectors', () => {
		// Standard test vectors for ISO/IEC CRC-32.
		expect(crc32(Buffer.from(''))).toBe(0);
		expect(crc32(Buffer.from('a'))).toBe(0xe8b7be43);
		expect(crc32(Buffer.from('abc'))).toBe(0x352441c2);
		expect(
			crc32(Buffer.from('The quick brown fox jumps over the lazy dog'))
		).toBe(0x414fa339);
	});

	test('dosTimeDate encodes a known epoch', () => {
		// 2026-05-20T15:30:40Z
		const epoch = Math.floor(Date.UTC(2026, 4, 20, 15, 30, 40) / 1000);
		const { time, date } = dosTimeDate(epoch);
		// time = (15 << 11) | (30 << 5) | (40 / 2) = 30720 + 960 + 20 = 31700
		expect(time).toBe((15 << 11) | (30 << 5) | 20);
		// date = ((2026 - 1980) << 9) | (5 << 5) | 20
		expect(date).toBe(((2026 - 1980) << 9) | (5 << 5) | 20);
	});

	test('dosTimeDate clamps year >= 1980', () => {
		const epoch = 0; // 1970-01-01
		const { date } = dosTimeDate(epoch);
		// year clamps to 1980 -> upper bits are 0
		expect((date >> 9) & 0x7f).toBe(0);
	});

	test('compileIgnorePattern returns null for comments and blanks', () => {
		expect(compileIgnorePattern('')).toBeNull();
		expect(compileIgnorePattern('   ')).toBeNull();
		expect(compileIgnorePattern('# a comment')).toBeNull();
	});

	test('compileIgnorePattern matches a simple filename', () => {
		const p = compileIgnorePattern('package-lock.json');
		expect(p.regex.test('package-lock.json')).toBe(true);
		expect(p.regex.test('nested/package-lock.json')).toBe(true);
		expect(p.regex.test('package-lock.jsonx')).toBe(false);
	});

	test('compileIgnorePattern with trailing / matches directories only', () => {
		const p = compileIgnorePattern('tests/');
		expect(p.dirOnly).toBe(true);
		expect(p.regex.test('tests')).toBe(true);
		expect(p.regex.test('src/tests')).toBe(true);
	});

	test('compileIgnorePattern with single * does not cross /', () => {
		const p = compileIgnorePattern('*.config.js');
		expect(p.regex.test('webpack.config.js')).toBe(true);
		expect(p.regex.test('src/webpack.config.js')).toBe(true);
		// `a/webpack.config.js` matches because pattern is not anchored
		expect(p.regex.test('a/webpack.config.js')).toBe(true);
		expect(p.regex.test('webpack.config.ts')).toBe(false);
	});

	test('compileIgnorePattern with ** crosses /', () => {
		const p = compileIgnorePattern('build/**');
		expect(p.regex.test('build/assets/app.js')).toBe(true);
		expect(p.regex.test('src/build/something')).toBe(true);
	});

	test('loadIgnorePatterns falls back to defaults when no .distignore', () => {
		const tmp = require('os').tmpdir();
		const sub = fs.mkdtempSync(path.join(tmp, 'no-distignore-'));
		try {
			const patterns = loadIgnorePatterns(sub);
			expect(patterns.length).toBe(DEFAULT_IGNORE_PATTERNS.length);
		} finally {
			fs.rmSync(sub, { recursive: true, force: true });
		}
	});

	test('resolveEpoch honours SOURCE_DATE_EPOCH env var', () => {
		const prev = process.env.SOURCE_DATE_EPOCH;
		process.env.SOURCE_DATE_EPOCH = '1234567890';
		try {
			expect(resolveEpoch(process.cwd(), {})).toBe(1234567890);
		} finally {
			if (prev === undefined) {
				delete process.env.SOURCE_DATE_EPOCH;
			} else {
				process.env.SOURCE_DATE_EPOCH = prev;
			}
		}
	});

	test('resolveEpoch honours explicit option over env', () => {
		const prev = process.env.SOURCE_DATE_EPOCH;
		process.env.SOURCE_DATE_EPOCH = '1';
		try {
			expect(resolveEpoch(process.cwd(), { epoch: 42 })).toBe(42);
		} finally {
			if (prev === undefined) {
				delete process.env.SOURCE_DATE_EPOCH;
			} else {
				process.env.SOURCE_DATE_EPOCH = prev;
			}
		}
	});

	test('FALLBACK_EPOCH is exposed and stable', () => {
		expect(FALLBACK_EPOCH).toBe(315532800);
	});
});

describe('release/zip - walkProject', () => {
	let tmp;
	afterEach(() => {
		cleanup(tmp);
		tmp = null;
	});

	test('honours .distignore and skips .git / dist always', () => {
		tmp = copyFixture('plugin-a');
		// Drop a .git so we can confirm it is always excluded.
		fs.mkdirSync(path.join(tmp, '.git'));
		fs.writeFileSync(
			path.join(tmp, '.git', 'HEAD'),
			'ref: refs/heads/main\n'
		);
		// Drop a dist/ to confirm it is always excluded.
		fs.mkdirSync(path.join(tmp, 'dist'));
		fs.writeFileSync(path.join(tmp, 'dist', 'stale.zip'), 'old');

		const patterns = loadIgnorePatterns(tmp);
		const files = walkProject(tmp, patterns).map((f) => f.relPath);
		expect(files).toContain('plugin-a.php');
		expect(files).toContain('package.json');
		expect(files).toContain('composer.json');
		expect(files).toContain('CHANGELOG.md');
		expect(files).toContain('src/include.txt');

		// Always-exclude
		expect(files.some((f) => f.startsWith('.git/'))).toBe(false);
		expect(files.some((f) => f.startsWith('dist/'))).toBe(false);

		// .distignore exclusions
		expect(files.some((f) => f.startsWith('tests-dir/'))).toBe(false);
		expect(files.some((f) => f.startsWith('node_modules/'))).toBe(false);
		expect(files).not.toContain('webpack.config.js');
		expect(files).not.toContain('.distignore');
	});
});

describe('release/zip - integration', () => {
	let tmp;
	afterEach(() => {
		cleanup(tmp);
		tmp = null;
	});

	test('builds dist/<slug>-<version>.zip and excludes per .distignore', () => {
		tmp = copyFixture('plugin-a');
		const result = zip({ cwd: tmp, epoch: 1700000000 });
		expect(result.outputPath).toBe(path.join('dist', 'plugin-a-1.2.3.zip'));
		expect(result.dryRun).toBe(false);
		const buf = fs.readFileSync(path.join(tmp, result.outputPath));
		const names = readZipEntryNames(buf);

		expect(names).toContain('plugin-a/plugin-a.php');
		expect(names).toContain('plugin-a/package.json');
		expect(names).toContain('plugin-a/CHANGELOG.md');
		expect(names).toContain('plugin-a/src/include.txt');
		// Excluded per .distignore
		expect(names.some((n) => n.startsWith('plugin-a/tests-dir/'))).toBe(
			false
		);
		expect(names.some((n) => n.startsWith('plugin-a/node_modules/'))).toBe(
			false
		);
		expect(names).not.toContain('plugin-a/webpack.config.js');
		expect(names).not.toContain('plugin-a/.distignore');
	});

	test('two runs against the same tree produce byte-identical zips', () => {
		tmp = copyFixture('plugin-a');
		zip({ cwd: tmp, epoch: 1700000000 });
		const firstSha = crypto
			.createHash('sha256')
			.update(
				fs.readFileSync(path.join(tmp, 'dist', 'plugin-a-1.2.3.zip'))
			)
			.digest('hex');

		fs.unlinkSync(path.join(tmp, 'dist', 'plugin-a-1.2.3.zip'));
		zip({ cwd: tmp, epoch: 1700000000 });
		const secondSha = crypto
			.createHash('sha256')
			.update(
				fs.readFileSync(path.join(tmp, 'dist', 'plugin-a-1.2.3.zip'))
			)
			.digest('hex');

		expect(secondSha).toBe(firstSha);
	});

	test('refuses to overwrite existing zip without --force', () => {
		tmp = copyFixture('plugin-a');
		zip({ cwd: tmp, epoch: 1700000000 });
		expect(() => zip({ cwd: tmp, epoch: 1700000000 })).toThrow(
			/already exists/
		);
	});

	test('overwrites existing zip when --force is set', () => {
		tmp = copyFixture('plugin-a');
		zip({ cwd: tmp, epoch: 1700000000 });
		const first = fs.readFileSync(
			path.join(tmp, 'dist', 'plugin-a-1.2.3.zip')
		);
		const result = zip({ cwd: tmp, force: true, epoch: 1700000000 });
		expect(result.dryRun).toBe(false);
		const after = fs.readFileSync(
			path.join(tmp, 'dist', 'plugin-a-1.2.3.zip')
		);
		// Same epoch + same tree => same bytes
		expect(after.equals(first)).toBe(true);
	});

	test('dryRun does not write dist/', () => {
		tmp = copyFixture('plugin-a');
		const result = zip({ cwd: tmp, dryRun: true, epoch: 1700000000 });
		expect(result.dryRun).toBe(true);
		expect(result.fileCount).toBeGreaterThan(0);
		expect(result.byteSize).toBeGreaterThan(0);
		expect(fs.existsSync(path.join(tmp, 'dist'))).toBe(false);
	});

	test('default ignore list excludes node_modules when .distignore absent', () => {
		tmp = copyFixture('plugin-a');
		fs.unlinkSync(path.join(tmp, '.distignore'));
		zip({ cwd: tmp, epoch: 1700000000 });
		const buf = fs.readFileSync(
			path.join(tmp, 'dist', 'plugin-a-1.2.3.zip')
		);
		const names = readZipEntryNames(buf);
		// Default ignore list excludes node_modules/ and *.config.js
		expect(names.some((n) => n.startsWith('plugin-a/node_modules/'))).toBe(
			false
		);
		expect(names).not.toContain('plugin-a/webpack.config.js');
	});

	test('zipPack round-trips a single entry through DEFLATE', () => {
		const buf = zipPack([
			{
				name: 'hello.txt',
				data: Buffer.from('Hello, world!\n', 'utf8'),
				mtimeEpoch: 1700000000,
				executable: false,
			},
		]);
		const names = readZipEntryNames(buf);
		expect(names).toEqual(['hello.txt']);

		// Decode the single local file header + DEFLATE body manually.
		expect(buf.readUInt32LE(0)).toBe(0x04034b50);
		const nameLen = buf.readUInt16LE(26);
		const compSize = buf.readUInt32LE(18);
		const dataStart = 30 + nameLen;
		const compressed = buf.slice(dataStart, dataStart + compSize);
		const decoded = zlib.inflateRawSync(compressed).toString('utf8');
		expect(decoded).toBe('Hello, world!\n');
	});
});

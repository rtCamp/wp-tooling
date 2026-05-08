'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	detectChanges,
	runCli,
	DEFAULT_IGNORE,
	DEFAULT_PATTERNS,
} = require('../../src/ci/detect-changes');

function tmpFile(name, body) {
	const p = path.join(
		os.tmpdir(),
		`dc-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`
	);
	fs.writeFileSync(p, body);
	return p;
}

describe('detectChanges', () => {
	test('counts files into the right buckets', () => {
		const files = [
			'src/foo.js',
			'src/style.scss',
			'plugin.php',
			'.github/workflows/test.yml',
			'.github/actions/setup/action.yml',
			'composer.json',
			'package.json',
			'phpstan-baseline.neon',
			'README.md',
		];
		const r = detectChanges({ files });
		expect(r['total-count']).toBe(9);
		expect(r['css-count']).toBe(2); // style.scss + package.json
		expect(r['js-count']).toBe(2); // foo.js + package.json
		expect(r['php-count']).toBe(3); // plugin.php + composer.json + phpstan-baseline.neon
		expect(r['gha-count']).toBe(2); // workflows + actions
	});

	test('default ignore excludes docs and .wordpress-org', () => {
		const files = [
			'docs/index.md',
			'.wordpress-org/screenshot.png',
			'src/foo.js',
		];
		const r = detectChanges({ files });
		expect(r['total-count']).toBe(1);
		expect(r['ignored-count']).toBe(2);
	});

	test('default ignore preserves .github/workflows and .github/actions', () => {
		const files = [
			'.github/workflows/ci.yml',
			'.github/actions/setup/action.yml',
			'.github/dependabot.yml',
			'.github/CODEOWNERS',
		];
		const r = detectChanges({ files });
		expect(r['gha-count']).toBe(2);
		expect(r['total-count']).toBe(2);
		expect(r['ignored-count']).toBe(2);
	});

	test('lockfile changes count under both css and js buckets', () => {
		const r = detectChanges({ files: ['package-lock.json'] });
		expect(r['css-count']).toBe(1);
		expect(r['js-count']).toBe(1);
		expect(r['php-count']).toBe(0);
	});

	test('phpstan.neon and phpstan.neon.dist count as php', () => {
		const r = detectChanges({
			files: ['phpstan.neon', 'phpstan.neon.dist'],
		});
		expect(r['php-count']).toBe(2);
	});

	test('composer.json and composer.lock count as php', () => {
		const r = detectChanges({ files: ['composer.json', 'composer.lock'] });
		expect(r['php-count']).toBe(2);
	});

	test('string --ignore overrides the default', () => {
		const r = detectChanges({
			files: ['docs/foo.md', 'src/foo.js'],
			ignore: 'src/',
		});
		expect(r['total-count']).toBe(1);
		expect(r['ignored-count']).toBe(1);
		expect(r['js-count']).toBe(0);
	});

	test('RegExp --ignore is accepted directly', () => {
		const r = detectChanges({
			files: ['docs/foo.md', 'src/foo.js'],
			ignore: /^src\//,
		});
		expect(r['ignored-count']).toBe(1);
	});

	test('null ignore disables filtering', () => {
		const r = detectChanges({
			files: ['docs/foo.md', 'src/foo.js'],
			ignore: null,
		});
		expect(r['total-count']).toBe(2);
		expect(r['ignored-count']).toBe(0);
	});

	test('empty-string ignore disables filtering', () => {
		const r = detectChanges({
			files: ['docs/foo.md', 'src/foo.js'],
			ignore: '',
		});
		expect(r['total-count']).toBe(2);
	});

	test('invalid ignore type throws TypeError', () => {
		expect(() => detectChanges({ files: [], ignore: 123 })).toThrow(
			TypeError
		);
	});

	test('accepts a newline-delimited string for files', () => {
		const r = detectChanges({ files: 'src/a.js\nsrc/b.css\n\n' });
		expect(r['total-count']).toBe(2);
		expect(r['js-count']).toBe(1);
		expect(r['css-count']).toBe(1);
	});

	test('tolerates Windows line endings in file list', () => {
		const r = detectChanges({ files: 'src/a.js\r\nsrc/b.css\r\n' });
		expect(r['total-count']).toBe(2);
	});

	test('invalid files type throws TypeError', () => {
		expect(() => detectChanges({ files: 42 })).toThrow(TypeError);
	});

	test('returns zero counts for an empty list', () => {
		const r = detectChanges({ files: [] });
		expect(r).toEqual({
			'total-count': 0,
			'ignored-count': 0,
			'css-count': 0,
			'js-count': 0,
			'php-count': 0,
			'gha-count': 0,
		});
	});

	test('gha bucket excludes nested-directory yml files outside workflows/actions', () => {
		const r = detectChanges({
			files: [
				'.github/workflows/ci.yml',
				'.github/something-else/foo.yml',
			],
			ignore: null,
		});
		expect(r['gha-count']).toBe(1);
	});
});

describe('exports', () => {
	test('DEFAULT_PATTERNS has the four expected buckets', () => {
		expect(Object.keys(DEFAULT_PATTERNS).sort()).toEqual([
			'css',
			'gha',
			'js',
			'php',
		]);
	});

	test('DEFAULT_IGNORE matches docs/, .wordpress-org/, and .github/ non-workflow paths', () => {
		expect(DEFAULT_IGNORE.test('docs/foo.md')).toBe(true);
		expect(DEFAULT_IGNORE.test('.wordpress-org/icon.png')).toBe(true);
		expect(DEFAULT_IGNORE.test('.github/dependabot.yml')).toBe(true);
		expect(DEFAULT_IGNORE.test('.github/workflows/ci.yml')).toBe(false);
		expect(DEFAULT_IGNORE.test('.github/actions/setup/action.yml')).toBe(
			false
		);
		expect(DEFAULT_IGNORE.test('src/foo.js')).toBe(false);
	});
});

describe('runCli', () => {
	let stdoutChunks;
	let stderrChunks;
	let stdoutSpy;
	let stderrSpy;

	beforeEach(() => {
		stdoutChunks = [];
		stderrChunks = [];
		stdoutSpy = jest
			.spyOn(process.stdout, 'write')
			.mockImplementation((chunk) => {
				stdoutChunks.push(chunk.toString());
				return true;
			});
		stderrSpy = jest
			.spyOn(process.stderr, 'write')
			.mockImplementation((chunk) => {
				stderrChunks.push(chunk.toString());
				return true;
			});
	});

	afterEach(() => {
		stdoutSpy.mockRestore();
		stderrSpy.mockRestore();
	});

	test('--help prints usage and exits 0', () => {
		const code = runCli(['--help']);
		expect(code).toBe(0);
		expect(stdoutChunks.join('')).toMatch(/Usage: detect-changes/);
	});

	test('unknown flag exits 2 with stderr message', () => {
		const code = runCli(['--bogus']);
		expect(code).toBe(2);
		expect(stderrChunks.join('')).toMatch(/unknown argument/);
	});

	test('invalid --output exits 2', () => {
		const code = runCli(['--output', 'xml']);
		expect(code).toBe(2);
		expect(stderrChunks.join('')).toMatch(/invalid --output/);
	});

	test('--files <path> with --output json prints valid JSON', () => {
		const f = tmpFile('files.txt', 'src/a.js\nsrc/b.css\n');
		try {
			const code = runCli(['--files', f, '--output', 'json']);
			expect(code).toBe(0);
			const parsed = JSON.parse(stdoutChunks.join(''));
			expect(parsed['total-count']).toBe(2);
			expect(parsed['js-count']).toBe(1);
			expect(parsed['css-count']).toBe(1);
		} finally {
			fs.unlinkSync(f);
		}
	});

	test('--output github appends key=value lines to $GITHUB_OUTPUT', () => {
		const filesPath = tmpFile('files.txt', 'src/a.js\n');
		const outPath = tmpFile('out.txt', '');
		const prev = process.env.GITHUB_OUTPUT;
		process.env.GITHUB_OUTPUT = outPath;
		try {
			const code = runCli(['--files', filesPath, '--output', 'github']);
			expect(code).toBe(0);
			const written = fs.readFileSync(outPath, 'utf8');
			expect(written).toMatch(/total-count=1/);
			expect(written).toMatch(/js-count=1/);
			expect(written).toMatch(/css-count=0/);
		} finally {
			if (prev === undefined) {
				delete process.env.GITHUB_OUTPUT;
			} else {
				process.env.GITHUB_OUTPUT = prev;
			}
			fs.unlinkSync(filesPath);
			fs.unlinkSync(outPath);
		}
	});

	test('--output github warns to stderr when GITHUB_OUTPUT is unset', () => {
		const filesPath = tmpFile('files.txt', 'src/a.js\n');
		const prev = process.env.GITHUB_OUTPUT;
		delete process.env.GITHUB_OUTPUT;
		try {
			const code = runCli(['--files', filesPath, '--output', 'github']);
			expect(code).toBe(0);
			expect(stderrChunks.join('')).toMatch(/GITHUB_OUTPUT/);
		} finally {
			if (prev !== undefined) {
				process.env.GITHUB_OUTPUT = prev;
			}
			fs.unlinkSync(filesPath);
		}
	});

	test('--dry-run parses cleanly and exits 0', () => {
		const f = tmpFile('files.txt', 'src/a.js\n');
		try {
			const code = runCli([
				'--dry-run',
				'--files',
				f,
				'--output',
				'json',
			]);
			expect(code).toBe(0);
		} finally {
			fs.unlinkSync(f);
		}
	});

	test('--dry-run + --output github does not touch $GITHUB_OUTPUT and previews to stdout', () => {
		const filesPath = tmpFile('files.txt', 'src/a.js\n');
		const outPath = tmpFile('out.txt', 'pre-existing-line\n');
		const before = fs.readFileSync(outPath, 'utf8');
		const prev = process.env.GITHUB_OUTPUT;
		process.env.GITHUB_OUTPUT = outPath;
		try {
			const code = runCli([
				'--dry-run',
				'--files',
				filesPath,
				'--output',
				'github',
			]);
			expect(code).toBe(0);
			expect(fs.readFileSync(outPath, 'utf8')).toBe(before);
			const out = stdoutChunks.join('');
			expect(out).toMatch(/\[dry-run\] would append to \$GITHUB_OUTPUT:/);
			expect(out).toMatch(/total-count=1/);
			expect(out).toMatch(/js-count=1/);
		} finally {
			if (prev === undefined) {
				delete process.env.GITHUB_OUTPUT;
			} else {
				process.env.GITHUB_OUTPUT = prev;
			}
			fs.unlinkSync(filesPath);
			fs.unlinkSync(outPath);
		}
	});

	test('--dry-run + --output github previews even when $GITHUB_OUTPUT is unset', () => {
		const filesPath = tmpFile('files.txt', 'src/a.js\n');
		const prev = process.env.GITHUB_OUTPUT;
		delete process.env.GITHUB_OUTPUT;
		try {
			const code = runCli([
				'--dry-run',
				'--files',
				filesPath,
				'--output',
				'github',
			]);
			expect(code).toBe(0);
			// No stderr warning -- dry-run short-circuits before the env check.
			expect(stderrChunks.join('')).not.toMatch(/GITHUB_OUTPUT/);
			expect(stdoutChunks.join('')).toMatch(/\[dry-run\] would append/);
		} finally {
			if (prev !== undefined) {
				process.env.GITHUB_OUTPUT = prev;
			}
			fs.unlinkSync(filesPath);
		}
	});

	test('text mode prints key: value lines', () => {
		const f = tmpFile('files.txt', 'src/a.js\n');
		try {
			const code = runCli(['--files', f]);
			expect(code).toBe(0);
			const out = stdoutChunks.join('');
			expect(out).toMatch(/total-count: 1/);
			expect(out).toMatch(/js-count: 1/);
		} finally {
			fs.unlinkSync(f);
		}
	});

	test('--ignore overrides default', () => {
		const f = tmpFile('files.txt', 'docs/foo.md\nsrc/foo.js\n');
		try {
			const code = runCli([
				'--files',
				f,
				'--ignore',
				'^src/',
				'--output',
				'json',
			]);
			expect(code).toBe(0);
			const parsed = JSON.parse(stdoutChunks.join(''));
			expect(parsed['total-count']).toBe(1);
			expect(parsed['ignored-count']).toBe(1);
		} finally {
			fs.unlinkSync(f);
		}
	});

	test('missing --files path exits 1 with stderr message', () => {
		const code = runCli([
			'--files',
			'/nonexistent/path-does-not-exist.txt',
		]);
		expect(code).toBe(1);
		expect(stderrChunks.join('')).toMatch(/cannot read file list/);
	});
});

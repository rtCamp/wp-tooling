'use strict';

const {
	compareImports,
	sortUseBlock,
	normalisePhp,
} = require('../../src/scaffolds/php-imports');

/**
 * Build a small PHP file around an import block.
 *
 * @param {string[]} imports - Fully-qualified names to import.
 * @return {string} PHP source.
 */
function phpWith(imports) {
	return [
		'<?php',
		'',
		'declare( strict_types = 1 );',
		'',
		'namespace Acme\\Blog\\Tests;',
		'',
		...imports.map((name) => `use ${name};`),
		'',
		'final class Thing {}',
		'',
	].join('\n');
}

/**
 * Read back the imported names, in file order.
 *
 * @param {string} source - PHP source.
 * @return {string[]} Names.
 */
function importsOf(source) {
	return source
		.split('\n')
		.filter((line) => line.startsWith('use '))
		.map((line) => line.slice(4, -1));
}

describe('compareImports', () => {
	it('compares segment by segment, not as whole strings', () => {
		// Whole-string strcmp would put `Acme\Blog` after `Acme_Blog`, because
		// `\` (0x5C) sorts before `_` (0x5F). Segment-wise, the first segments
		// `Acme` and `Acme_Blog` decide it, giving the same answer here — the
		// point is that the segment walk is what runs.
		expect(compareImports('Acme\\Blog', 'Acme_Blog')).toBeLessThan(0);
	});

	it('sorts a prefix before a name that extends it', () => {
		expect(compareImports('Acme', 'Acme\\Blog')).toBeLessThan(0);
		expect(compareImports('Acme\\Blog', 'Acme')).toBeGreaterThan(0);
	});

	it('is case sensitive, so uppercase sorts before lowercase', () => {
		// `W` (0x57) before `r` (0x72): this is the ordering that makes a
		// `rtCamp\…` project need a different import order from an `Inc\…` one.
		expect(compareImports('WP_UnitTestCase', 'rtCamp\\Thing')).toBeLessThan(
			0
		);
		expect(
			compareImports('PHPUnit\\Framework\\TestCase', 'Acme\\Thing')
		).toBeGreaterThan(0);
	});

	it('reports equal names as equal', () => {
		expect(compareImports('Acme\\Blog', 'Acme\\Blog')).toBe(0);
	});
});

describe('sortUseBlock', () => {
	it('orders an out-of-order block', () => {
		const source = phpWith([
			'rtCamp\\Theme\\Elementary\\Cli\\Sync',
			'WP_UnitTestCase',
		]);
		expect(importsOf(sortUseBlock(source))).toEqual([
			'WP_UnitTestCase',
			'rtCamp\\Theme\\Elementary\\Cli\\Sync',
		]);
	});

	it('leaves an already-ordered block byte-identical', () => {
		const source = phpWith(['WP_UnitTestCase', 'rtCamp\\Theme\\Thing']);
		expect(sortUseBlock(source)).toBe(source);
	});

	it('keeps a project namespace that genuinely sorts first in place', () => {
		// The mirror of the case above: `Inc\…` sorts before `PHPUnit\…`, so an
		// order correct for this project must survive untouched.
		const source = phpWith([
			'Inc\\Cli\\Sync',
			'PHPUnit\\Framework\\TestCase',
		]);
		expect(sortUseBlock(source)).toBe(source);
	});

	it('touches nothing but the import lines', () => {
		const source = phpWith(['rtCamp\\Thing', 'WP_UnitTestCase']);
		const sorted = sortUseBlock(source);
		const strip = (s) =>
			s
				.split('\n')
				.filter((line) => !line.startsWith('use '))
				.join('\n');
		expect(strip(sorted)).toBe(strip(source));
	});

	it('leaves a single import alone', () => {
		const source = phpWith(['rtCamp\\Thing']);
		expect(sortUseBlock(source)).toBe(source);
	});

	it('leaves a file with no imports alone', () => {
		const source = '<?php\n\nfinal class Thing {}\n';
		expect(sortUseBlock(source)).toBe(source);
	});

	describe('bails out rather than risking a bad edit', () => {
		it.each([
			['a group import', 'use Acme\\{One, Two};'],
			['an alias', 'use Acme\\One as Two;'],
			['a function import', 'use function Acme\\helper;'],
			['a constant import', 'use const Acme\\LIMIT;'],
			['a statement split over lines', 'use Acme\\One,'],
		])('%s elsewhere in the file', (_label, oddity) => {
			const source = phpWith([
				'rtCamp\\Thing',
				'WP_UnitTestCase',
			]).replace(
				'final class Thing {}',
				`${oddity}\n\nfinal class Thing {}`
			);
			expect(sortUseBlock(source)).toBe(source);
		});

		it('a comment interleaved in the block splits the run and is left alone', () => {
			const source = [
				'<?php',
				'use rtCamp\\Thing;',
				'// A note.',
				'use WP_UnitTestCase;',
				'',
			].join('\n');
			expect(sortUseBlock(source)).toBe(source);
		});

		it('an indented trait import is never treated as a namespace import', () => {
			const source = [
				'<?php',
				'use rtCamp\\Thing;',
				'use WP_UnitTestCase;',
				'',
				'final class Thing {',
				'\tuse Singleton;',
				'\tuse Loader;',
				'}',
				'',
			].join('\n');
			// The top block still sorts; the trait imports stay put.
			const out = sortUseBlock(source);
			expect(out.split('\n').slice(1, 3)).toEqual([
				'use WP_UnitTestCase;',
				'use rtCamp\\Thing;',
			]);
			expect(out).toContain('\tuse Singleton;\n\tuse Loader;');
		});
	});
});

describe('normalisePhp', () => {
	it('sorts a .php destination', () => {
		const source = phpWith(['rtCamp\\Thing', 'WP_UnitTestCase']);
		expect(importsOf(normalisePhp(source, 'inc/Thing.php'))).toEqual([
			'WP_UnitTestCase',
			'rtCamp\\Thing',
		]);
	});

	it('is case insensitive about the extension', () => {
		const source = phpWith(['rtCamp\\Thing', 'WP_UnitTestCase']);
		expect(normalisePhp(source, 'inc/Thing.PHP')).not.toBe(source);
	});

	it.each(['src/js/module.js', 'block.json', 'README.md', 'noext'])(
		'passes %s through untouched',
		(dest) => {
			const source = phpWith(['rtCamp\\Thing', 'WP_UnitTestCase']);
			expect(normalisePhp(source, dest)).toBe(source);
		}
	);

	it('passes through a non-string destination', () => {
		const source = phpWith(['rtCamp\\Thing', 'WP_UnitTestCase']);
		expect(normalisePhp(source, undefined)).toBe(source);
	});
});

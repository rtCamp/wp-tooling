/**
 * Tests for src/scaffolds/render.js.
 *
 * Covers placeholder substitution, undefined-placeholder errors,
 * HTML-escape disabled (critical for code generation), and the four
 * input transforms.
 */

'use strict';

const {
	render,
	collectPlaceholders,
	applyTransform,
	RenderError,
} = require('../../src/scaffolds/render');

describe('render', () => {
	it('substitutes a single placeholder', () => {
		expect(render('Hello {{name}}', { name: 'world' })).toBe('Hello world');
	});

	it('substitutes multiple placeholders', () => {
		expect(render('{{a}}/{{b}}.php', { a: 'src', b: 'Foo' })).toBe(
			'src/Foo.php'
		);
	});

	it('substitutes the same placeholder repeatedly', () => {
		expect(render('{{x}}-{{x}}', { x: 'q' })).toBe('q-q');
	});

	it('accepts whitespace inside braces', () => {
		expect(render('{{ name }}', { name: 'w' })).toBe('w');
	});

	it('throws ERENDERFAIL on undefined placeholder', () => {
		expect(() => render('{{missing}}', {})).toThrow(RenderError);
		try {
			render('{{missing}}', {});
		} catch (err) {
			expect(err.code).toBe('ERENDERFAIL');
			expect(err.placeholder).toBe('missing');
		}
	});

	it('does NOT HTML-escape (critical for code generation)', () => {
		const out = render('echo {{html}};', {
			html: '<script>alert(1)</script>',
		});
		expect(out).toBe('echo <script>alert(1)</script>;');
	});

	it('treats null vars argument as empty', () => {
		expect(() => render('{{x}}', null)).toThrow(RenderError);
	});

	it('passes through templates with no placeholders', () => {
		expect(render('static text', {})).toBe('static text');
	});

	it('throws on non-string template', () => {
		expect(() => render(123, {})).toThrow(RenderError);
	});
});

describe('collectPlaceholders', () => {
	it('lists unique placeholders in first-appearance order', () => {
		expect(collectPlaceholders('{{a}}/{{b}}/{{a}}/{{c}}')).toEqual([
			'a',
			'b',
			'c',
		]);
	});

	it('returns empty array for templates with no placeholders', () => {
		expect(collectPlaceholders('plain text')).toEqual([]);
	});

	it('returns empty for non-string input', () => {
		expect(collectPlaceholders(null)).toEqual([]);
	});
});

describe('applyTransform', () => {
	it('pascal-case from kebab', () => {
		expect(applyTransform('qm-export', 'pascal-case')).toBe('QmExport');
	});

	it('pascal-case from snake', () => {
		expect(applyTransform('foo_bar_baz', 'pascal-case')).toBe('FooBarBaz');
	});

	it('kebab-case from PascalCase', () => {
		expect(applyTransform('QmExport', 'kebab-case')).toBe('qm-export');
	});

	it('snake-case from kebab', () => {
		expect(applyTransform('qm-export', 'snake-case')).toBe('qm_export');
	});

	it('upper-snake-case from kebab', () => {
		expect(applyTransform('wporg-username', 'upper-snake-case')).toBe(
			'WPORG_USERNAME'
		);
	});

	it('returns value unchanged when no transform', () => {
		expect(applyTransform('Foo', undefined)).toBe('Foo');
	});

	it('returns value unchanged for unknown transform', () => {
		expect(applyTransform('Foo', 'unknown')).toBe('Foo');
	});
});

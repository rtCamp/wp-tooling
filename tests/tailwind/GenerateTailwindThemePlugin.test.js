'use strict';

const {
	generateThemeBlock,
} = require('../../src/tailwind/GenerateTailwindThemePlugin');

describe('generateThemeBlock', () => {
	describe('preset sections', () => {
		test('maps color palette to --color-* variables', () => {
			const result = generateThemeBlock({
				settings: {
					color: {
						palette: [
							{
								slug: 'primary',
								color: '#242321',
								name: 'Primary',
							},
							{
								slug: 'secondary',
								color: '#666',
								name: 'Secondary',
							},
						],
					},
				},
			});

			expect(result).toContain(
				'--color-primary: var(--wp--preset--color--primary)'
			);
			expect(result).toContain(
				'--color-secondary: var(--wp--preset--color--secondary)'
			);
		});

		test('maps fontSizes to --text-* variables', () => {
			const result = generateThemeBlock({
				settings: {
					typography: {
						fontSizes: [
							{ slug: 'small', size: '1rem', name: 'Small' },
							{ slug: 'large', size: '1.75rem', name: 'Large' },
						],
					},
				},
			});

			expect(result).toContain(
				'--text-small: var(--wp--preset--font-size--small)'
			);
			expect(result).toContain(
				'--text-large: var(--wp--preset--font-size--large)'
			);
		});

		test('maps fontFamilies to --font-* variables', () => {
			const result = generateThemeBlock({
				settings: {
					typography: {
						fontFamilies: [
							{
								slug: 'system-font',
								fontFamily: 'sans-serif',
								name: 'System Font',
							},
						],
					},
				},
			});

			expect(result).toContain(
				'--font-system-font: var(--wp--preset--font-family--system-font)'
			);
		});

		test('maps spacingSizes to --spacing-* variables', () => {
			const result = generateThemeBlock({
				settings: {
					spacing: {
						spacingSizes: [
							{ slug: '40', size: '1rem', name: 'Small' },
							{ slug: 'medium', size: '2rem', name: 'Medium' },
						],
					},
				},
			});

			expect(result).toContain(
				'--spacing-40: var(--wp--preset--spacing--40)'
			);
			expect(result).toContain(
				'--spacing-medium: var(--wp--preset--spacing--medium)'
			);
		});

		test('maps shadow presets to --shadow-* variables', () => {
			const result = generateThemeBlock({
				settings: {
					shadow: {
						presets: [
							{ slug: 'natural', shadow: '...', name: 'Natural' },
						],
					},
				},
			});

			expect(result).toContain(
				'--shadow-natural: var(--wp--preset--shadow--natural)'
			);
		});
	});

	describe('layout tokens', () => {
		test('emits both layout variables when contentSize and wideSize are set', () => {
			const result = generateThemeBlock({
				settings: {
					layout: { contentSize: '620px', wideSize: '1260px' },
				},
			});

			expect(result).toContain(
				'--max-width-content: var(--wp--style--global--content-size)'
			);
			expect(result).toContain(
				'--max-width-wide: var(--wp--style--global--wide-size)'
			);
		});

		test('emits only contentSize when wideSize is absent', () => {
			const result = generateThemeBlock({
				settings: { layout: { contentSize: '620px' } },
			});

			expect(result).toContain(
				'--max-width-content: var(--wp--style--global--content-size)'
			);
			expect(result).not.toContain('--max-width-wide');
		});

		test('emits only wideSize when contentSize is absent', () => {
			const result = generateThemeBlock({
				settings: { layout: { wideSize: '1260px' } },
			});

			expect(result).not.toContain('--max-width-content');
			expect(result).toContain(
				'--max-width-wide: var(--wp--style--global--wide-size)'
			);
		});

		test('omits layout block when settings.layout is absent', () => {
			const result = generateThemeBlock({ settings: {} });

			expect(result).not.toContain('--max-width-content');
			expect(result).not.toContain('--max-width-wide');
		});
	});

	describe('edge cases', () => {
		test('skips entry with missing slug and warns', () => {
			const warn = jest
				.spyOn(console, 'warn')
				.mockImplementation(() => {});

			const result = generateThemeBlock({
				settings: {
					color: {
						palette: [
							{ color: '#000', name: 'No Slug' },
							{
								slug: 'primary',
								color: '#242321',
								name: 'Primary',
							},
						],
					},
				},
			});

			expect(result).toContain('--color-primary');
			expect(result).not.toContain('undefined');
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('missing slug')
			);
		});

		test('skips preset section when array is empty', () => {
			const result = generateThemeBlock({
				settings: { color: { palette: [] } },
			});

			expect(result).not.toContain('--color-');
		});

		test('skips preset section when key is absent', () => {
			const result = generateThemeBlock({ settings: {} });

			expect(result).not.toContain('--color-');
			expect(result).not.toContain('--text-');
		});

		test('returns a valid @theme {} block for empty themeJson', () => {
			const result = generateThemeBlock({});

			expect(result).toMatch(/^@theme \{/);
			expect(result).toMatch(/\}\n$/);
		});
	});
});

'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_NAME = 'GenerateTailwindThemePlugin';

/**
 * Build the file header for tailwind.css, including an @source directive that
 * points from the CSS file's directory back to the project root so Tailwind v4
 * scans all template files (PHP, Twig, JS, etc.) regardless of where the CSS
 * file lives within the project tree.
 *
 * @param {string} tailwindCssPath Absolute path to the output tailwind.css.
 * @return {string} CSS header string.
 */
const generateBaseCss = (tailwindCssPath) => {
	const cssDir = path.dirname(tailwindCssPath);
	const relToRoot = path.relative(cssDir, process.cwd());
	const sourceDir = relToRoot.split(path.sep).join('/') + '/';
	return `/* Auto-generated from theme.json by GenerateTailwindThemePlugin */
@source "${sourceDir}";
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);

`;
};

/**
 * Maps theme.json preset paths to WordPress CSS variable types and Tailwind v4 namespace prefixes.
 *
 * @type {Array<{keyPath: string[], wpType: string, twPrefix: string}>}
 */
const PRESET_MAP = [
	{
		keyPath: ['settings', 'color', 'palette'],
		wpType: 'color',
		twPrefix: '--color',
	},
	{
		keyPath: ['settings', 'typography', 'fontSizes'],
		wpType: 'font-size',
		twPrefix: '--text',
	},
	{
		keyPath: ['settings', 'typography', 'fontFamilies'],
		wpType: 'font-family',
		twPrefix: '--font',
	},
	{
		keyPath: ['settings', 'spacing', 'spacingSizes'],
		wpType: 'spacing',
		twPrefix: '--spacing',
	},
	{
		keyPath: ['settings', 'shadow', 'presets'],
		wpType: 'shadow',
		twPrefix: '--shadow',
	},
];

/**
 * Safely read a nested value from an object by key path.
 *
 * @param {Object}   obj  Source object.
 * @param {string[]} keys Key path.
 * @return {*} Value at the key path, or undefined.
 */
const get = (obj, keys) => keys.reduce((acc, key) => acc?.[key], obj);

/**
 * Generate the @theme {} block content from a parsed theme.json object.
 *
 * @param {Object} themeJson Parsed theme.json content.
 * @return {string} Full @theme {} block as a CSS string.
 */
const generateThemeBlock = (themeJson) => {
	const lines = [];

	for (const { keyPath, wpType, twPrefix } of PRESET_MAP) {
		const items = get(themeJson, keyPath);

		if (!Array.isArray(items) || items.length === 0) {
			continue;
		}

		lines.push(`\t/* ${keyPath.at(-1)} */`);

		for (const item of items) {
			if (!item.slug) {
				console.warn(
					`[${PLUGIN_NAME}] Skipping ${wpType} entry with missing slug: ${JSON.stringify(item)}`
				);
				continue;
			}
			lines.push(
				`\t${twPrefix}-${item.slug}: var(--wp--preset--${wpType}--${item.slug});`
			);
		}

		lines.push('');
	}

	const layout = get(themeJson, ['settings', 'layout']) ?? {};

	if (layout.contentSize || layout.wideSize) {
		lines.push('\t/* layout */');
		if (layout.contentSize) {
			lines.push(
				'\t--max-width-content: var(--wp--style--global--content-size);'
			);
		}
		if (layout.wideSize) {
			lines.push(
				'\t--max-width-wide: var(--wp--style--global--wide-size);'
			);
		}
		lines.push('');
	}

	if (lines.at(-1) === '') {
		lines.pop();
	}

	return `@theme {\n${lines.join('\n')}\n}\n`;
};

/**
 * Webpack plugin that generates a Tailwind CSS entry point from theme.json.
 *
 * Reads theme.json and writes a tailwind.css file containing the Tailwind layer
 * imports and an @theme {} block that maps WordPress preset CSS custom properties
 * to Tailwind v4 utility namespaces (--color-*, --text-*, --font-*, --spacing-*, --shadow-*).
 *
 * Usage in webpack.config.js:
 *
 *   const { GenerateTailwindThemePlugin } = require( '@rtcamp/wp-tooling/tailwind-config' );
 *
 *   plugins: [
 *     new GenerateTailwindThemePlugin(),
 *   ]
 *
 * Options:
 *   - themeJson   {string} Absolute path to theme.json. Defaults to <cwd>/theme.json.
 *   - tailwindCss {string} Absolute path to the output tailwind.css.
 *                          Defaults to <cwd>/src/css/frontend/tailwind.css.
 *
 * Opt-in pattern (PHP side):
 *   The compiled output at assets/build/css/frontend/tailwind.css is only enqueued
 *   when src/css/frontend/tailwind.css is present (i.e. this plugin has run).
 *   Consuming themes can force-enable or disable via a constant or filter —
 *   see the theme's Assets class for the expected wiring.
 */
class GenerateTailwindThemePlugin {
	/**
	 * @param {Object} options
	 * @param {string} [options.themeJson]   Absolute path to theme.json.
	 * @param {string} [options.tailwindCss] Absolute path to the output tailwind.css.
	 */
	constructor({ themeJson, tailwindCss } = {}) {
		this.themeJsonPath =
			themeJson ?? path.resolve(process.cwd(), 'theme.json');
		this.tailwindCssPath =
			tailwindCss ??
			path.resolve(
				process.cwd(),
				'src',
				'css',
				'frontend',
				'tailwind.css'
			);
	}

	/**
	 * Generate the tailwind.css file from theme.json.
	 *
	 * @return {void}
	 */
	generate() {
		if (!fs.existsSync(this.themeJsonPath)) {
			console.error(
				`[${PLUGIN_NAME}] theme.json not found at ${this.themeJsonPath}`
			);
			return;
		}

		let themeJson;
		try {
			themeJson = JSON.parse(fs.readFileSync(this.themeJsonPath, 'utf8'));
		} catch (err) {
			console.error(
				`[${PLUGIN_NAME}] Failed to parse theme.json — ${err.message}`
			);
			return;
		}

		const output =
			generateBaseCss(this.tailwindCssPath) +
			generateThemeBlock(themeJson);
		fs.mkdirSync(path.dirname(this.tailwindCssPath), { recursive: true });

		const existing = fs.existsSync(this.tailwindCssPath)
			? fs.readFileSync(this.tailwindCssPath, 'utf8')
			: null;

		if (existing === output) {
			return;
		}

		fs.writeFileSync(this.tailwindCssPath, output, 'utf8');
		console.log(`[${PLUGIN_NAME}] Written to ${this.tailwindCssPath}`);
	}

	/**
	 * Wire the plugin into the webpack compiler lifecycle.
	 *
	 * @param {import('webpack').Compiler} compiler Webpack compiler instance.
	 * @return {void}
	 */
	apply(compiler) {
		// Single builds (compiler.run()). Not called in watch mode.
		compiler.hooks.run.tap(PLUGIN_NAME, () => this.generate());

		// Watch mode — covers both the initial compilation (modifiedFiles is
		// undefined on the first watchRun) and subsequent rebuilds when theme.json changes.
		compiler.hooks.watchRun.tap(PLUGIN_NAME, (comp) => {
			const modified = comp.modifiedFiles;
			if (!modified || modified.has(this.themeJsonPath)) {
				this.generate();
			}
		});

		// Re-register theme.json as a watched file dependency on every compilation
		// so webpack keeps tracking it between rebuilds.
		compiler.hooks.afterEmit.tap(PLUGIN_NAME, (compilation) => {
			compilation.fileDependencies.add(this.themeJsonPath);
		});
	}
}

module.exports = { GenerateTailwindThemePlugin, generateThemeBlock };

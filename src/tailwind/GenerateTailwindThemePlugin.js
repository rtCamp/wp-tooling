'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_NAME = 'GenerateTailwindThemePlugin';

/**
 * Build the one-time scaffold written to tailwind.css on first run.
 *
 * Imports the Tailwind layers and the generated _tailwind-theme.css file.
 * After first run this file is owned by the consumer and never overwritten.
 *
 * @param {string} tailwindCssPath      Absolute path to tailwind.css.
 * @param {string} tailwindThemeCssPath Absolute path to _tailwind-theme.css.
 * @return {string} CSS scaffold string.
 */
const generateEntryScaffold = (tailwindCssPath, tailwindThemeCssPath) => {
	const cssDir = path.dirname(tailwindCssPath);
	const relToRoot = path.relative(cssDir, process.cwd());
	const sourceDir = relToRoot.split(path.sep).join('/') + '/';
	const themeImport =
		'./' +
		path.relative(cssDir, tailwindThemeCssPath).split(path.sep).join('/');
	return `/* Tailwind CSS entry — edit freely. WordPress preset tokens live in ${path.basename(tailwindThemeCssPath)}. */
@source "${sourceDir}";
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@import "${themeImport}";
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
		this.tailwindThemeCssPath = path.join(
			path.dirname(this.tailwindCssPath),
			'_tailwind-theme.css'
		);
	}

	/**
	 * Generate _tailwind-theme.css from theme.json, and scaffold tailwind.css on first run.
	 *
	 * _tailwind-theme.css is always regenerated — it is a pure build artifact derived
	 * from theme.json and should be gitignored. tailwind.css is written once and then
	 * owned by the consumer; subsequent builds never touch it.
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

		fs.mkdirSync(path.dirname(this.tailwindThemeCssPath), {
			recursive: true,
		});

		// Always keep _tailwind-theme.css in sync with theme.json.
		const themeOutput =
			`/* Auto-generated from theme.json by ${PLUGIN_NAME} — do not edit. */\n` +
			generateThemeBlock(themeJson);
		const existingTheme = fs.existsSync(this.tailwindThemeCssPath)
			? fs.readFileSync(this.tailwindThemeCssPath, 'utf8')
			: null;
		if (existingTheme !== themeOutput) {
			fs.writeFileSync(this.tailwindThemeCssPath, themeOutput, 'utf8');
			console.log(
				`[${PLUGIN_NAME}] Written to ${this.tailwindThemeCssPath}`
			);
		}

		// Scaffold tailwind.css once — after first run it belongs to the consumer.
		if (!fs.existsSync(this.tailwindCssPath)) {
			const scaffold = generateEntryScaffold(
				this.tailwindCssPath,
				this.tailwindThemeCssPath
			);
			fs.writeFileSync(this.tailwindCssPath, scaffold, 'utf8');
			console.log(`[${PLUGIN_NAME}] Scaffolded ${this.tailwindCssPath}`);
		}
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

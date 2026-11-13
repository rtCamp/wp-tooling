/**
 * The Interactivity API usages WordPress 7.2 stops supporting, as regexes
 * over raw source text.
 *
 * Source: WordPress/gutenberg#84098 ("Interactivity API: Remove expired
 * deprecated behaviors", merged 2026-10-06, Gutenberg 24.2). Only the client
 * runtime changed; server-side directive processing is unchanged.
 *
 * Directives are written in render.php, block templates, patterns, PHP
 * strings and JSX alike, so the rules read raw text instead of parsed HTML.
 * A directive name is `data-wp-` plus letters, digits, `_` and `-` (the
 * runtime's own character set), and `(?<![\w-])` keeps a match from starting
 * inside a longer name. The runtime splits a name at the first `--` (the
 * suffix) and at `---` (the unique ID): `data-wp-watch---id` has a unique ID
 * and no suffix, `data-wp-watch--id` has the suffix `id`.
 */

'use strict';

const WP_VERSION = '7.2';
const WP_RELEASE_DATE = '2026-12-09';
const SOURCE_URL = 'https://github.com/WordPress/gutenberg/pull/84098';

/** Every extension a directive can be written in. */
const MARKUP_EXTENSIONS = Object.freeze([
	'php',
	'html',
	'js',
	'jsx',
	'ts',
	'tsx',
	'mjs',
	'cjs',
]);

/** Script extensions, for the store rule. */
const SCRIPT_EXTENSIONS = Object.freeze([
	'js',
	'jsx',
	'ts',
	'tsx',
	'mjs',
	'cjs',
]);

const NAME_PREFIX_LENGTH = 'data-wp-'.length;

/**
 * `data-wp-ignore`, exactly: the runtime only ever matched the bare name.
 */
const IGNORE_RE = /(?<![\w-])data-wp-ignore(?![\w-])/gi;

/**
 * `data-wp-init|watch|run` + exactly two hyphens + a unique ID. The ID either
 * starts with a name character (so `---id` never matches), or is built at
 * run time: the name is followed by `$` (`"...--$id"`, `` `...--${id}` ``),
 * `{` (`"...--{$id}"`), `%` (`sprintf( '...--%s', $id )`), `<` (an inline PHP
 * tag, `...--<?php echo $id; ?>`), or a closing quote and concatenation
 * (`'data-wp-watch--' . $id`, `'...--' + id`). A closing quote on its own
 * (`set_attribute( 'data-wp-watch--', ... )`) is a directive with no ID, which
 * still works. Placeholders such as `--[id]` in prose don't match.
 */
const LIFECYCLE_RE =
	/(?<![\w-])data-wp-(init|watch|run)--(?:(\w[\w-]*)|(?=[{$%<]|['"`]\s*[.+]))/gi;

/**
 * `data-wp-on|on-window|on-document--<event>--<id>`. The event is segments
 * joined by single hyphens (`click`, `my-custom-event`), then exactly two
 * hyphens, then an ID as in LIFECYCLE_RE. `data-wp-on-async*` can't match:
 * `on` must be followed by `--`, `-window--` or `-document--`.
 */
const EVENT_RE =
	/(?<![\w-])data-wp-(on|on-window|on-document)--(\w+(?:-\w+)*)--(?:(\w[\w-]*)|(?=[{$%<]|['"`]\s*[.+]))/gi;

/**
 * A `data-wp-*` name, its separator (`=` in HTML and JSX, `=>` in a PHP
 * array, `:` in a JS object, `,` in `set_attribute()`, after an optional
 * closing quote and `]`, with spaces allowed before the `]`), an optional JSX
 * `{`, an opening quote (escaped, as in a PHP `echo "...=\"...\""`, or not),
 * then a value that negates `actions.*` or `callbacks.*`. The runtime reads
 * the namespace first, so only `!actions.x` and `ns::!actions.x` are matched:
 * `!ns::actions.x` never resolved its namespace, so 7.2 changes nothing there.
 */
const NEGATED_RE =
	/(?<![\w-])(data-wp-[\w-]+)['"]?\s*\]?\s*(?:=>|=|:|,)\s*\{?\s*\\?['"`]((?:[\w/-]+::)?!(?:actions|callbacks)\.[\w$.]*)/gi;

/** Destructuring from `store( 'core/router' )` or the router package's import(). */
const ROUTER_DESTRUCTURE_RE =
	/\{([^{}]*)\}\s*=\s*(?:await\s+)?(?:store\s*\(\s*['"]core\/router['"]|import\s*\(\s*['"]@wordpress\/interactivity-router['"]\s*\))/g;

/** `import { state } from '@wordpress/interactivity-router'`. */
const ROUTER_IMPORT_RE =
	/import\s*\{([^{}]*)\}\s*from\s*['"]@wordpress\/interactivity-router['"]/g;

/** `const router = store( 'core/router' )`, read as `router.state`. */
const ROUTER_STORE_BINDING_RE =
	/(?:const|let|var)\s+([\w$]+)\s*=\s*(?:await\s+)?store\s*\(\s*['"]core\/router['"]/g;

/**
 * The expressions that hold core/router's state in `text`: each name its
 * `state` is bound to (`const { state: router } = store( 'core/router' )`
 * gives `router`), `<name>.state` for a whole-store binding, and a direct
 * `store( 'core/router' ).state`. With no binding found (the store is read
 * some other way), `state` is assumed.
 *
 * @param {string} text Source text.
 * @return {string[]} Regular-expression sources, one per expression.
 */
function routerStateHeads(text) {
	// Every regular-expression metacharacter, though the names that reach here
	// are identifiers ([\w$]), so only `$` can actually occur.
	const escape = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const heads = new Set();
	for (const re of [ROUTER_DESTRUCTURE_RE, ROUTER_IMPORT_RE]) {
		for (const match of text.matchAll(re)) {
			for (const part of match[1].split(',')) {
				const binding = part
					.trim()
					.match(/^state(?:\s*(?::|\bas\b)\s*([\w$]+))?$/);
				if (binding) {
					heads.add(escape(binding[1] || 'state'));
				}
			}
		}
	}
	for (const match of text.matchAll(ROUTER_STORE_BINDING_RE)) {
		heads.add(`${escape(match[1])}\\??\\.state`);
	}
	if (!heads.size) {
		heads.add('state');
	}
	heads.add(`store\\(\\s*['"]core\\/router['"]\\s*\\)\\.state`);
	return [...heads];
}

/**
 * `<router state>.navigation` or `?.navigation`, as a whole property access,
 * where `<router state>` is one of routerStateHeads(). A `state` that belongs
 * to another store in the same file is not matched.
 *
 * @param {string} text Source text.
 * @return {RegExp} Global pattern for this file.
 */
function routerPattern(text) {
	return new RegExp(
		`(?<![\\w$])(?:${routerStateHeads(text).join('|')})\\??\\.navigation(?![\\w$])`,
		'g'
	);
}

/** A file that reads the router store names it or imports its package. */
const ROUTER_STORE_RE = /core\/router|interactivity-router/;

/**
 * Insert a hyphen into `text` at `at`: `--` becomes `---`.
 *
 * @param {string} text
 * @param {number} at
 * @return {string} The text with one more hyphen.
 */
function addHyphen(text, at) {
	return `${text.slice(0, at)}-${text.slice(at)}`;
}

/**
 * Describe a `data-wp-ignore` match.
 *
 * @param {Array} match RegExp match.
 * @return {Object} `{ index, text, replacement, message }`.
 */
function describeIgnore(match) {
	return {
		index: match.index,
		text: match[0],
		replacement: null,
		message: `${match[0]} is removed in WordPress ${WP_VERSION}: the element and its descendants now hydrate like any other element. Remove the attribute.`,
	};
}

/**
 * Describe a two-hyphen lifecycle directive match.
 *
 * @param {Array} match RegExp match: `[1]` directive, `[2]` ID (absent when built at run time).
 * @return {Object} `{ index, text, replacement, message }`.
 */
function describeLifecycle(match) {
	const [text, directive, id] = match;
	const name = text.slice(0, NAME_PREFIX_LENGTH + directive.length);
	const replacement = addHyphen(text, name.length);
	const subject = id
		? `${text} uses a two-hyphen unique ID.`
		: `${text} is followed by a unique ID built at run time, after two hyphens.`;
	const fix = id
		? `Use ${replacement}.`
		: `Use ${replacement} before the ID.`;
	return {
		index: match.index,
		text,
		replacement,
		message: `${subject} WordPress ${WP_VERSION} skips ${name} directives that have a suffix, so this callback never runs. ${fix}`,
	};
}

/**
 * Describe a two-hyphen event directive match.
 *
 * @param {Array} match RegExp match: `[1]` directive, `[2]` event, `[3]` ID (absent when built at run time).
 * @return {Object} `{ index, text, replacement, message }`.
 */
function describeEvent(match) {
	const [text, directive, event, id] = match;
	const suffixAt = NAME_PREFIX_LENGTH + directive.length + 2;
	const replacement = addHyphen(text, suffixAt + event.length);
	const suffix = text.slice(suffixAt);
	const subject = id
		? `${text} uses a two-hyphen unique ID.`
		: `${text} is followed by a unique ID built at run time, after two hyphens.`;
	const eventName = id ? suffix : `${suffix} plus the ID`;
	const fix = id
		? `Use ${replacement}.`
		: `Use ${replacement} before the ID.`;
	return {
		index: match.index,
		text,
		replacement,
		message: `${subject} WordPress ${WP_VERSION} reads ${eventName} as the event name, so the handler no longer fires on ${event}. ${fix}`,
	};
}

/**
 * Describe a negated-function match. It is located at the value, not the name.
 *
 * @param {Array} match RegExp match: `[1]` attribute name, `[2]` value.
 * @return {Object} `{ index, text, replacement, message }`.
 */
function describeNegated(match) {
	const [whole, attribute, value] = match;
	return {
		index: match.index + whole.length - value.length,
		text: value,
		replacement: null,
		message: `${value} in ${attribute} negates a function. WordPress ${WP_VERSION} no longer calls it, so the value is undefined. Move the negation into derived state (a getter on state) and reference that getter without "!".`,
	};
}

/**
 * Describe a `core/router` `state.navigation` match.
 *
 * @param {Array} match RegExp match.
 * @return {Object} `{ index, text, replacement, message }`.
 */
function describeRouter(match) {
	const navigating = match[0].replace(/\??\.navigation$/, '.navigating');
	return {
		index: match.index,
		text: match[0],
		replacement: null,
		message: `${match[0]} from the core/router store is deprecated since WordPress 7.0, and a later release removes direct access. Read ${navigating} instead once the plugin requires WordPress 7.2 (@wordpress/interactivity-router 2.57.0); until then this warning is safe to leave.`,
	};
}

/**
 * The rules, in report order. `appliesTo`, when present, must accept the file
 * text before the pattern runs. A rule has a fixed `pattern`, or a
 * `patternFor( text )` that builds one for the file.
 */
const RULES = Object.freeze([
	{
		id: 'ignore-directive',
		severity: 'error',
		extensions: MARKUP_EXTENSIONS,
		pattern: IGNORE_RE,
		describe: describeIgnore,
	},
	{
		id: 'lifecycle-double-hyphen-id',
		severity: 'error',
		extensions: MARKUP_EXTENSIONS,
		pattern: LIFECYCLE_RE,
		describe: describeLifecycle,
	},
	{
		id: 'event-double-hyphen-id',
		severity: 'error',
		extensions: MARKUP_EXTENSIONS,
		pattern: EVENT_RE,
		describe: describeEvent,
	},
	{
		id: 'negated-function',
		severity: 'error',
		extensions: MARKUP_EXTENSIONS,
		pattern: NEGATED_RE,
		describe: describeNegated,
	},
	{
		id: 'router-state-navigation',
		severity: 'warning',
		extensions: SCRIPT_EXTENSIONS,
		patternFor: routerPattern,
		appliesTo: (text) => ROUTER_STORE_RE.test(text),
		describe: describeRouter,
	},
]);

module.exports = {
	RULES,
	MARKUP_EXTENSIONS,
	SCRIPT_EXTENSIONS,
	SOURCE_URL,
	WP_RELEASE_DATE,
	WP_VERSION,
};

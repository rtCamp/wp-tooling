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
 * run time: the name is followed by a closing quote (`'data-wp-watch--' .
 * $id`), `$` (`"...--$id"`, `` `...--${id}` ``), `{` (`"...--{$id}"`) or `%`
 * (`sprintf( '...--%s', $id )`). Placeholders such as `--[id]` in prose don't
 * match.
 */
const LIFECYCLE_RE =
	/(?<![\w-])data-wp-(init|watch|run)--(?:(\w[\w-]*)|(?=[{$%'"`]))/gi;

/**
 * `data-wp-on|on-window|on-document--<event>--<id>`. The event is segments
 * joined by single hyphens (`click`, `my-custom-event`), then exactly two
 * hyphens, then an ID as in LIFECYCLE_RE. `data-wp-on-async*` can't match:
 * `on` must be followed by `--`, `-window--` or `-document--`.
 */
const EVENT_RE =
	/(?<![\w-])data-wp-(on|on-window|on-document)--(\w+(?:-\w+)*)--(?:(\w[\w-]*)|(?=[{$%'"`]))/gi;

/**
 * A `data-wp-*` name, its separator (`=` in HTML and JSX, `=>` in a PHP
 * array, `:` in a JS object, `,` in `set_attribute()`, after an optional
 * closing quote and `]`), an optional JSX `{`, an opening quote, then a value
 * that negates `actions.*` or `callbacks.*`. The runtime reads the namespace
 * first (`ns::!actions.x`); `!ns::actions.x` is matched too.
 */
const NEGATED_RE =
	/(?<![\w-])(data-wp-[\w-]+)['"]?\]?\s*(?:=>|=|:|,)\s*\{?\s*['"`]((?:[\w/-]+::)?!(?:[\w/-]+::)?(?:actions|callbacks)\.[\w$.]*)/gi;

/** `state.navigation` or `state?.navigation`, as a whole property access. */
const ROUTER_RE = /(?<![\w$])state\??\.navigation(?![\w$])/g;

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
	return {
		index: match.index,
		text: match[0],
		replacement: null,
		message: `${match[0]} from the core/router store is deprecated since WordPress 7.0, and a later release removes direct access. Read state.navigating instead (core/router, @wordpress/interactivity-router 2.57.0 and later).`,
	};
}

/**
 * The rules, in report order. `appliesTo`, when present, must accept the file
 * text before the pattern runs.
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
		pattern: ROUTER_RE,
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

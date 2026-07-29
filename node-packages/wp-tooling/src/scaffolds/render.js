/**
 * Minimal Mustache-style renderer for scaffold templates.
 *
 * Hand-rolled because the package policy is zero runtime dependencies.
 * Supports the subset the scaffold engine needs:
 *
 *   {{name}}                       simple variable substitution
 *   {{base_path}}/foo              variables inside paths
 *   {{#flag}}...{{/flag}}          section: render inner content when truthy
 *   {{^flag}}...{{/flag}}          inverted section: render when falsy
 *
 * Section flags are string values. Truthy = non-empty and not one of
 * `"false"`, `"no"`, `"0"`. Sections do not nest within themselves and
 * cannot iterate (we only need boolean flags, e.g. singleton vs multi).
 *
 * Does NOT support: partials, comments, set delimiters, iterating over
 * arrays/lists. Extend here if a scaffold ever needs more.
 *
 * Critical: HTML escape is DISABLED. Templates render code (PHP, JS, YAML);
 * HTML-encoding would mangle generated code. This matches the project rule
 * `Mustache.escape = (text) => text` documented in CLAUDE.md.
 *
 * Undefined placeholders throw `RenderError` with code `ERENDERFAIL`. We
 * never silently render empty strings.
 *
 * Implements:
 *   WTL-06  rendering used by execute() for files, dests, and wiring snippets
 *   WTL-10  conditional sections enabling pattern-flag templates (singleton/multi)
 */

'use strict';

class RenderError extends Error {
	constructor(message, details = {}) {
		super(message);
		this.name = 'RenderError';
		this.code = details.code || 'ERENDERFAIL';
		Object.assign(this, details);
	}
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const SECTION_OPEN_RE = /\{\{([#^])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const SECTION_CLOSE_RE = /\{\{\/\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const ANY_TAG_RE = /\{\{[#^/]?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

const FALSY_STRINGS = new Set(['', 'false', 'no', '0']);

function isTruthy(value) {
	if (typeof value !== 'string') {
		return Boolean(value);
	}
	return !FALSY_STRINGS.has(value.trim().toLowerCase());
}

/**
 * Index every closing tag in a template by key, in one linear scan.
 *
 * Positions per key come out in ascending order, which lets the section walk
 * consume them with a monotonic cursor instead of re-scanning the template for
 * each opening tag.
 *
 * @param {string} template - The template to scan.
 * @return {Map<string, Array<{index: number, length: number}>>} Closes by key.
 */
function indexCloseTags(template) {
	const byKey = new Map();
	let match;

	SECTION_CLOSE_RE.lastIndex = 0;
	while ((match = SECTION_CLOSE_RE.exec(template)) !== null) {
		const key = match[1];
		let list = byKey.get(key);
		if (!list) {
			list = [];
			byKey.set(key, list);
		}
		list.push({ index: match.index, length: match[0].length });
	}

	return byKey;
}

/**
 * Resolve every section of one kind — `#` (keep inner when truthy) or `^`
 * (keep inner when falsy) — in a single left-to-right pass.
 *
 * Closing tags are indexed once up front, so matching an opening tag to its
 * close is a cursor bump rather than a search. That keeps the pass linear even
 * when the template is nothing but unclosed opening tags — both the original
 * `{{#key}}([\s\S]*?){{/key}}` pattern and a naive scan-forward-for-each-open
 * rescan to end-of-string every time, which is quadratic.
 *
 * An opening tag with no matching close is left in the output verbatim, which
 * is what the old pattern did by simply failing to match.
 *
 * @param {string} template - The template to scan.
 * @param {string} wanted   - Section kind to resolve: `'#'` or `'^'`.
 * @param {Object} safeVars - Resolved input values keyed by name.
 * @return {string} Template with that kind of section resolved.
 * @throws {RenderError} If a section flag is not in `safeVars`.
 */
function renderSections(template, wanted, safeVars) {
	const closesByKey = indexCloseTags(template);
	// How far into each key's close list we have already looked. Opening tags
	// are visited left to right, so these only ever move forward.
	const seen = new Map();
	let out = '';
	let cursor = 0;
	let open;

	SECTION_OPEN_RE.lastIndex = 0;
	while ((open = SECTION_OPEN_RE.exec(template)) !== null) {
		const [openTag, kind, key] = open;
		if (kind !== wanted) {
			continue;
		}
		const innerStart = open.index + openTag.length;

		// First close for this key at or after innerStart. Closes for other
		// keys are ignored, matching the old backreference behaviour.
		const closes = closesByKey.get(key);
		if (!closes) {
			continue;
		}
		let at = seen.get(key) || 0;
		while (at < closes.length && closes[at].index < innerStart) {
			at++;
		}
		seen.set(key, at);
		if (at >= closes.length) {
			continue;
		}
		const close = closes[at];

		if (!Object.prototype.hasOwnProperty.call(safeVars, key)) {
			throw new RenderError(`undefined placeholder '${key}'`, {
				code: 'ERENDERFAIL',
				placeholder: key,
			});
		}

		const truthy = isTruthy(safeVars[key]);
		const keep = wanted === '#' ? truthy : !truthy;
		const inner = template.slice(innerStart, close.index);

		out += template.slice(cursor, open.index) + (keep ? inner : '');
		cursor = close.index + close.length;
		SECTION_OPEN_RE.lastIndex = cursor;
	}

	return out + template.slice(cursor);
}

/**
 * Render a Mustache-style template string with the given variables.
 *
 * Three passes, in order:
 *   1. Sections          `{{#flag}}...{{/flag}}` keep inner when truthy.
 *   2. Inverted sections `{{^flag}}...{{/flag}}` keep inner when falsy.
 *   3. Variables         `{{name}}` substituted with `vars[name]`.
 *
 * Sections stay two separate passes rather than one combined walk: the second
 * pass sees tags the first one left behind, and collapsing them into a single
 * ordered walk changes the output for same-key nesting.
 *
 * Section flags and variables are looked up the same way (both throw
 * ERENDERFAIL when the key is not in `vars`).
 *
 * @param {string}                template - The template to render.
 * @param {Object<string,string>} vars     - Resolved input values keyed by name.
 * @return {string} Rendered string.
 * @throws {RenderError} If a placeholder is not in `vars`.
 */
function render(template, vars) {
	if (typeof template !== 'string') {
		throw new RenderError('render(): template must be a string', {
			code: 'ERENDERFAIL',
			received: typeof template,
		});
	}
	const safeVars = vars && typeof vars === 'object' ? vars : {};

	let result = renderSections(template, '#', safeVars);
	result = renderSections(result, '^', safeVars);

	return result.replace(PLACEHOLDER_RE, (_match, key) => {
		if (!Object.prototype.hasOwnProperty.call(safeVars, key)) {
			throw new RenderError(`undefined placeholder '${key}'`, {
				code: 'ERENDERFAIL',
				placeholder: key,
			});
		}
		return String(safeVars[key]);
	});
}

/**
 * Collect every distinct placeholder name in a template, including
 * section flags (`{{#key}}`, `{{^key}}`) and closing tags (`{{/key}}`).
 *
 * Used by execute() to determine which inputs a scaffold needs when the
 * manifest has no explicit `inputs[]` block (backward-compat path).
 *
 * @param {string} template
 * @return {string[]} Unique placeholder names, in first-appearance order.
 */
function collectPlaceholders(template) {
	if (typeof template !== 'string') {
		return [];
	}
	const seen = new Set();
	let match;
	ANY_TAG_RE.lastIndex = 0;
	while ((match = ANY_TAG_RE.exec(template)) !== null) {
		seen.add(match[1]);
	}
	return Array.from(seen);
}

const TRANSFORMS = {
	'pascal-case': (s) => splitWords(s).map(capitalise).join(''),
	'kebab-case': (s) => splitWords(s).join('-').toLowerCase(),
	'snake-case': (s) => splitWords(s).join('_').toLowerCase(),
	'upper-snake-case': (s) => splitWords(s).join('_').toUpperCase(),
	// JSON-encode backslashes so a PHP namespace can be embedded inside a
	// JSON snippet (e.g. a composer.json PSR-4 key): Acme\Blog -> Acme\\Blog.
	'json-escape': (s) => String(s).replace(/\\/g, '\\\\'),
};

function splitWords(s) {
	return String(s)
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.split(/[\s_\-/.]+/)
		.filter(Boolean);
}

function capitalise(word) {
	return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Apply a named transform to a value. Returns the value unchanged if no
 * transform is named (or the name is not recognised; validation should have
 * caught unknown names already).
 *
 * @param {string}           value
 * @param {string|undefined} name  - One of `pascal-case`, `kebab-case`, ...
 * @return {string} The transformed value (or the input unchanged when no transform applies).
 */
function applyTransform(value, name) {
	if (!name) {
		return value;
	}
	const fn = TRANSFORMS[name];
	return fn ? fn(value) : value;
}

module.exports = { render, collectPlaceholders, applyTransform, RenderError };

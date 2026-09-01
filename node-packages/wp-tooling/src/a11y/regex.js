/**
 * Shared regular expressions for parsing pa11y-ci issue codes and context
 * HTML snippets. Centralised here, one documented pattern per constant,
 * rather than inlined (and unexplained) at each use site.
 */

'use strict';

/**
 * Pulls the `<digit>_<digit>_<digit>` WCAG success-criterion segment out of
 * an HTMLCS code, e.g. `...Guideline1_1.1_1_1.H37` captures `1`, `1`, `1`
 * (→ `1.1.1`). Axe rule ids (e.g. `image-alt`) carry no such segment and
 * simply don't match.
 */
const WCAG_CRITERION_RE = /(\d+)_(\d+)_(\d+)/;

/**
 * Matches the tag name at the very start of a context HTML snippet, e.g.
 * `<img src="...">` captures `img`. Leading whitespace is tolerated.
 */
const TAG_FROM_CONTEXT_RE = /^\s*<\s*([a-zA-Z][\w-]*)/;

/**
 * Matches a leading tag name in a single CSS selector segment, e.g.
 * `button.cta` captures `button`. Used as a fallback when the context
 * snippet has no opening tag to read the tag name from.
 */
const TAG_FROM_SELECTOR_RE = /^([a-zA-Z][\w-]*)/;

/**
 * Matches the first HTML opening (or self-closing/void) tag in a context
 * snippet, e.g. `<img src="/hero.jpg">` — captures the whole tag so its
 * attributes can be extracted separately.
 */
const OPEN_TAG_RE = /<[^>]*>/;

/**
 * Matches one `name="value"` or `name='value'` HTML attribute pair inside
 * an opening tag. Global — callers must reset `.lastIndex = 0` before each
 * fresh scan, since this same regex instance is reused across calls.
 */
const ATTR_RE =
	/([a-zA-Z_:][-\w:.]*)\s*=\s*"([^"]*)"|([a-zA-Z_:][-\w:.]*)\s*=\s*'([^']*)'/g;

module.exports = {
	WCAG_CRITERION_RE,
	TAG_FROM_CONTEXT_RE,
	TAG_FROM_SELECTOR_RE,
	OPEN_TAG_RE,
	ATTR_RE,
};

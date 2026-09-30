/**
 * Shared regular expressions for parsing pa11y-ci issue codes and context
 * HTML snippets. Centralised here, one documented pattern per constant,
 * rather than inlined (and unexplained) at each use site.
 */

'use strict';

/**
 * Matches a whole dot-delimited WCAG success-criterion segment of an HTMLCS
 * code, e.g. `1_1_1` captures `1`, `1`, `1` (→ `1.1.1`). Anchoring avoids
 * retrying at every digit on failure. Multi-digit components are supported.
 */
const WCAG_CRITERION_RE = /^(\d+)_(\d+)_(\d+)$/;

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
 * Consumes one attribute name and optional equals sign at the cursor.
 * Sticky matching prevents retries inside a long name when no value follows.
 * Quoted values are consumed separately, without regex backtracking.
 */
const ATTR_NAME_RE = /([a-zA-Z_:][-\w:.]*)\s*(=\s*)?/y;

module.exports = {
	WCAG_CRITERION_RE,
	TAG_FROM_CONTEXT_RE,
	TAG_FROM_SELECTOR_RE,
	ATTR_NAME_RE,
};

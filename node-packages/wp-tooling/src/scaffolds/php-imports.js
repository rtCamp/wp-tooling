'use strict';

/**
 * Sort the `use` block of rendered PHP.
 *
 * A Mustache template cannot emit a correctly ordered import block, because the
 * order depends on a value only known at render time: the consuming project's
 * own namespace. `use {{namespace}}\{{class}};` sorts before `use WP_UnitTestCase;`
 * for a project namespaced `Inc\…` and after it for one namespaced `rtCamp\…`,
 * and no fixed ordering in the template satisfies both. Sorting here — once the
 * placeholders are filled — is the only place the right answer exists.
 *
 * The ordering reproduces `SlevomatCodingStandard.Namespaces.AlphabeticallySortedUses`
 * with `caseSensitive="true"`, which is what the `rtCampWP` standard enables:
 * names are compared **segment by segment** (split on `\`) with a byte-wise
 * comparison, and a prefix sorts before a longer name that extends it. Comparing
 * whole strings instead would disagree wherever `\` (0x5C) falls between the
 * bytes being compared.
 *
 * Deliberately conservative. This is line matching, not PHP parsing: the block
 * is rewritten only when every line of it is a plain single-class import, and
 * anything else — a group import, an alias, a `use function`/`use const`, a
 * statement split over lines, a comment in the middle, a second block later in
 * the file — leaves the source untouched rather than risking a bad edit. Every
 * template in the catalogue emits the simple shape, so the bail-outs exist for
 * templates that do not exist yet.
 *
 * Trait imports inside a class body are indented and never match, which is why
 * the pattern is anchored to column zero.
 */

// One plain class import: `use Fully\Qualified\Name;` at column zero. A single
// space after `use` and no trailing content, matching what every template emits
// and what the sniff leaves alone.
const USE_LINE_RE =
	/^use ([A-Za-z_\x80-￿][A-Za-z0-9_\x80-￿]*(?:\\[A-Za-z_\x80-￿][A-Za-z0-9_\x80-￿]*)*);$/;

// Any top-level `use` at all, including the shapes this module refuses to touch.
// Used to detect an import the block scan did not cover, which forces a bail-out.
const ANY_TOP_LEVEL_USE_RE = /^use\b/;

/**
 * Byte-wise string comparison, the semantics of PHP's `strcmp()`.
 *
 * Comparing JS strings with `<` uses UTF-16 code units, which agrees with a byte
 * comparison for ASCII but not beyond it. Namespaces are ASCII in practice;
 * going through Buffer keeps the two in step regardless.
 *
 * @param {string} a - Left operand.
 * @param {string} b - Right operand.
 * @return {number} Negative, zero or positive.
 */
function strcmp(a, b) {
	return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Order two fully-qualified names the way the sniff does.
 *
 * @param {string} a - Left fully-qualified name, no leading separator.
 * @param {string} b - Right fully-qualified name, no leading separator.
 * @return {number} Negative, zero or positive.
 */
function compareImports(a, b) {
	const aParts = a.split('\\');
	const bParts = b.split('\\');
	const shared = Math.min(aParts.length, bParts.length);

	for (let i = 0; i < shared; i++) {
		const cmp = strcmp(aParts[i], bParts[i]);
		if (cmp !== 0) {
			return cmp;
		}
	}

	// Every shared segment matched, so the shorter name is the prefix of the
	// longer one and sorts first.
	return aParts.length - bParts.length;
}

/**
 * Return `source` with its import block sorted, or unchanged if it cannot be
 * rewritten safely.
 *
 * @param {string} source - Rendered PHP source.
 * @return {string} The source, with the import block ordered.
 */
function sortUseBlock(source) {
	if (typeof source !== 'string' || !source.includes('\nuse ')) {
		return source;
	}

	const lines = source.split('\n');

	const start = lines.findIndex((line) => USE_LINE_RE.test(line));
	if (start === -1) {
		return source;
	}

	let end = start;
	while (end + 1 < lines.length && USE_LINE_RE.test(lines[end + 1])) {
		end++;
	}

	// A lone import is already sorted; rewriting would only risk churn.
	if (end === start) {
		return source;
	}

	// An import outside the run means the file has a shape this module does not
	// model — a second block, or one of the forms USE_LINE_RE rejects. Leave it.
	for (let i = 0; i < lines.length; i++) {
		if (i >= start && i <= end) {
			continue;
		}
		if (ANY_TOP_LEVEL_USE_RE.test(lines[i])) {
			return source;
		}
	}

	const block = lines.slice(start, end + 1);
	const sorted = [...block].sort((a, b) =>
		compareImports(a.match(USE_LINE_RE)[1], b.match(USE_LINE_RE)[1])
	);

	// Already in order: return the original string so callers can rely on
	// identity when nothing needed doing.
	if (sorted.every((line, i) => line === block[i])) {
		return source;
	}

	lines.splice(start, block.length, ...sorted);
	return lines.join('\n');
}

/**
 * Apply the PHP-only normalisations to one rendered file.
 *
 * Non-PHP destinations pass through untouched, so callers can hand every
 * rendered file to this without checking first.
 *
 * @param {string} source  - Rendered file contents.
 * @param {string} destRel - Project-relative destination path.
 * @return {string} Contents to write.
 */
function normalisePhp(source, destRel) {
	if (
		typeof destRel !== 'string' ||
		!destRel.toLowerCase().endsWith('.php')
	) {
		return source;
	}
	return sortUseBlock(source);
}

module.exports = { compareImports, sortUseBlock, normalisePhp };

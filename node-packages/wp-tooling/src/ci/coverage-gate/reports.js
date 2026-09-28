/**
 * Coverage report parsers. Each returns the same shape: file path as written
 * in the report → executable line number → hit count.
 *
 * Hand-rolled on purpose — zero runtime dependencies, and both formats are
 * flat enough that a real XML parser buys nothing. Clover is scanned with
 * `indexOf` rather than regexes so a malformed or hostile report stays linear
 * (a PR controls the paths, and can shape the report its own tests write).
 */

'use strict';

const path = require('path');

const XML_ENTITY_RE = /&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi;
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Clover line types that are executable. PHPUnit also writes `type="method"`
 * on each signature line — a declaration, so it never counts.
 */
const CLOVER_EXECUTABLE_TYPES = new Set(['stmt', 'cond']);

const MAX_CODE_POINT = 0x10ffff;

/**
 * Decode the five predefined XML entities plus numeric references. A numeric
 * reference beyond Unicode is left as written rather than throwing.
 *
 * @param {string} value
 * @return {string} Decoded text.
 */
function decodeXml(value) {
	return value.replace(XML_ENTITY_RE, (entity, hex, dec, named) => {
		if (named) {
			return XML_ENTITIES[named.toLowerCase()];
		}
		const codePoint = hex ? parseInt(hex, 16) : parseInt(dec, 10);
		return codePoint <= MAX_CODE_POINT
			? String.fromCodePoint(codePoint)
			: entity;
	});
}

/**
 * Parse XML attributes out of a tag's attribute string, in one pass.
 *
 * @param {string} source e.g. ` num="12" type="stmt" count="0"`.
 * @return {Object<string, string>} Attribute name → decoded value.
 */
function parseAttributes(source) {
	const attrs = Object.create(null);
	let from = 0;
	for (;;) {
		const eq = source.indexOf('=', from);
		if (eq === -1) {
			return attrs;
		}
		let open = eq + 1;
		while (open < source.length && /\s/.test(source[open])) {
			open++;
		}
		const quote = source[open];
		if (quote !== '"' && quote !== "'") {
			from = eq + 1;
			continue;
		}
		const close = source.indexOf(quote, open + 1);
		if (close === -1) {
			return attrs;
		}
		const name = source.slice(from, eq).trim().split(/\s+/).pop();
		attrs[name] = decodeXml(source.slice(open + 1, close));
		from = close + 1;
	}
}

/**
 * Find the next `<tag …>` or `<tag …/>` at or after `from`.
 *
 * @param {string} xml
 * @param {string} tag  Element name.
 * @param {number} from Search start.
 * @return {{ attrs: string, selfClosing: boolean, end: number }|null} The tag's attribute source, whether it closes itself, and the index just past its `>`; `null` when there is none.
 */
function nextTag(xml, tag, from) {
	const open = `<${tag}`;
	for (
		let start = xml.indexOf(open, from);
		start !== -1;
		start = xml.indexOf(open, start + open.length)
	) {
		const after = start + open.length;
		if (!/[\s/>]/.test(xml[after] ?? '')) {
			continue; // `<filename`, not `<file`.
		}
		const close = xml.indexOf('>', after);
		if (close === -1) {
			return null;
		}
		const selfClosing = xml[close - 1] === '/';
		return {
			attrs: xml.slice(after, selfClosing ? close - 1 : close),
			selfClosing,
			end: close + 1,
		};
	}
	return null;
}

/**
 * Get (or create) the hit map for a report file.
 *
 * @param {Map<string, Map<number, number>>} report
 * @param {string}                           file
 * @return {Map<number, number>} Line → hit count for `file`.
 */
function hitsFor(report, file) {
	if (!report.has(file)) {
		report.set(file, new Map());
	}
	return report.get(file);
}

/**
 * Record a hit count, keeping the highest when a line repeats (a `cond` and a
 * `stmt` on one line, or a file listed in two LCOV records).
 *
 * @param {Map<number, number>} hits
 * @param {number}              lineNo
 * @param {number}              count
 */
function recordHit(hits, lineNo, count) {
	hits.set(lineNo, Math.max(hits.get(lineNo) ?? 0, count));
}

/**
 * Record the executable `<line>` entries inside one Clover `<file>` body.
 *
 * @param {Map<number, number>} hits Destination.
 * @param {string}              body Markup between `<file>` and `</file>`.
 */
function readCloverLines(hits, body) {
	for (
		let line = nextTag(body, 'line', 0);
		line;
		line = nextTag(body, 'line', line.end)
	) {
		const attrs = parseAttributes(line.attrs);
		if (!CLOVER_EXECUTABLE_TYPES.has(attrs.type)) {
			continue;
		}
		const lineNo = Number(attrs.num);
		const count = Number(attrs.count);
		if (Number.isInteger(lineNo) && Number.isFinite(count)) {
			recordHit(hits, lineNo, count);
		}
	}
}

/**
 * Parse a Clover XML report (PHPUnit `--coverage-clover`). A `<file>` with no
 * closing `</file>` ends the scan: the report was truncated.
 *
 * @param {string} xml Report contents.
 * @return {Map<string, Map<number, number>>} File path → line → hit count.
 */
function parseClover(xml) {
	const report = new Map();
	let from = 0;
	for (
		let file = nextTag(xml, 'file', 0);
		file;
		file = nextTag(xml, 'file', from)
	) {
		from = file.end;
		let body = '';
		if (!file.selfClosing) {
			const close = xml.indexOf('</file>', from);
			if (close === -1) {
				break;
			}
			body = xml.slice(from, close);
			from = close + '</file>'.length;
		}
		const { name } = parseAttributes(file.attrs);
		if (name) {
			readCloverLines(hitsFor(report, name), body);
		}
	}
	return report;
}

/**
 * Parse an LCOV tracefile (Jest `--coverageReporters=lcov`).
 *
 * @param {string} text Report contents.
 * @return {Map<string, Map<number, number>>} File path → line → hit count.
 */
function parseLcov(text) {
	const report = new Map();
	let hits = null;
	for (const rawLine of text.split(/\r?\n/)) {
		const record = rawLine.trim();
		if (record.startsWith('SF:')) {
			hits = hitsFor(report, record.slice(3));
			continue;
		}
		if (record === 'end_of_record') {
			hits = null;
			continue;
		}
		if (!hits || !record.startsWith('DA:')) {
			continue;
		}
		// DA:<line>,<count>[,<checksum>]
		const [lineNo, count] = record.slice(3).split(',');
		if (/^\d+$/.test(lineNo) && /^-?\d+$/.test(count)) {
			recordHit(hits, Number(lineNo), Number(count));
		}
	}
	return report;
}

const PARSERS = { clover: parseClover, lcov: parseLcov };

/**
 * Parse a report in the given format.
 *
 * @param {string} format `clover` or `lcov`.
 * @param {string} text   Report contents.
 * @return {Map<string, Map<number, number>>} File path → line → hit count.
 */
function parseReport(format, text) {
	return PARSERS[format](text);
}

/**
 * Infer the report format from its file name.
 *
 * @param {string} reportPath
 * @return {string|null} `clover`, `lcov`, or `null` when it can't tell.
 */
function inferFormat(reportPath) {
	const name = path.basename(reportPath).toLowerCase();
	if (name.endsWith('.xml')) {
		return 'clover';
	}
	if (name.endsWith('.info') || name.includes('lcov')) {
		return 'lcov';
	}
	return null;
}

module.exports = {
	parseClover,
	parseLcov,
	parseReport,
	inferFormat,
	REPORT_FORMATS: Object.keys(PARSERS),
};

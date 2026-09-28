/**
 * Coverage report parsers. Each returns the same shape: file path as written
 * in the report → executable line number → hit count.
 *
 * Regex-based on purpose — zero runtime dependencies, and both formats are
 * flat enough that a real XML parser buys nothing.
 */

'use strict';

const path = require('path');

const CLOVER_FILE_RE = /<file\b([^>]*?)(?:\/>|>([\s\S]*?)<\/file>)/g;
const CLOVER_LINE_RE = /<line\b([^>]*?)\/?>/g;
const XML_ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
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
 * Parse XML attributes out of a tag's attribute string.
 *
 * @param {string} source e.g. ` num="12" type="stmt" count="0"`.
 * @return {Object<string, string>} Attribute name → decoded value.
 */
function parseAttributes(source) {
	return Object.fromEntries(
		[...source.matchAll(XML_ATTR_RE)].map((attr) => [
			attr[1],
			decodeXml(attr[2] ?? attr[3]),
		])
	);
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
	for (const lineMatch of body.matchAll(CLOVER_LINE_RE)) {
		const attrs = parseAttributes(lineMatch[1]);
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
 * Parse a Clover XML report (PHPUnit `--coverage-clover`).
 *
 * @param {string} xml Report contents.
 * @return {Map<string, Map<number, number>>} File path → line → hit count.
 */
function parseClover(xml) {
	const report = new Map();
	for (const fileMatch of xml.matchAll(CLOVER_FILE_RE)) {
		const { name } = parseAttributes(fileMatch[1]);
		if (name) {
			readCloverLines(hitsFor(report, name), fileMatch[2] ?? '');
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

'use strict';

const fs = require('fs');
const path = require('path');

const {
	normalizeA11y,
	parseWcagCriterion,
	extractDomHints,
} = require('../../src/a11y/normalize');

const RAW = JSON.parse(
	fs.readFileSync(path.join(__dirname, 'fixtures', 'pa11y-ci.json'), 'utf8')
);

describe('normalizeA11y', () => {
	const report = normalizeA11y(RAW);

	test('tags the tool and default standard', () => {
		expect(report.tool).toBe('pa11y-ci');
		expect(report.standard).toBe('WCAG2AA');
	});

	test('summary counts violations by impact across URLs', () => {
		expect(report.summary).toEqual({
			urls: 2,
			violations: 4,
			errors: 2,
			warnings: 1,
			notices: 1,
			passedUrls: 1,
			failedUrls: 0,
		});
	});

	test('results are sorted by URL', () => {
		expect(report.results.map((r) => r.url)).toEqual([
			'http://localhost:8888/',
			'http://localhost:8888/about',
		]);
	});

	test('a URL with no issues is reported as clean', () => {
		const about = report.results.find(
			(r) => r.url === 'http://localhost:8888/about'
		);
		expect(about.violations).toEqual([]);
	});

	test('violations sort by impact, then id, then selector', () => {
		const home = report.results.find(
			(r) => r.url === 'http://localhost:8888/'
		);
		expect(home.violations.map((v) => v.id)).toEqual([
			'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
			'color-contrast',
			'WCAG2AA.Principle1.Guideline1_3.1_3_1.H42.2',
			'WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.A.NoContent',
		]);
		expect(home.violations.map((v) => v.impact)).toEqual([
			'error',
			'error',
			'warning',
			'notice',
		]);
	});

	test('maps HTMLCS codes to a WCAG criterion and axe codes to null', () => {
		const home = report.results.find(
			(r) => r.url === 'http://localhost:8888/'
		);
		const byId = Object.fromEntries(home.violations.map((v) => [v.id, v]));
		expect(
			byId['WCAG2AA.Principle1.Guideline1_1.1_1_1.H37'].wcagCriterion
		).toBe('1.1.1');
		expect(byId['color-contrast'].wcagCriterion).toBeNull();
		expect(
			byId['WCAG2AA.Principle1.Guideline1_3.1_3_1.H42.2'].wcagCriterion
		).toBe('1.3.1');
		expect(
			byId['WCAG2AA.Principle4.Guideline4_1.4_1_2.H91.A.NoContent']
				.wcagCriterion
		).toBe('4.1.2');
	});

	test('extracts DOM hints from the context for the grep-to-source step', () => {
		const home = report.results.find(
			(r) => r.url === 'http://localhost:8888/'
		);
		const img = home.violations.find((v) => v.id.endsWith('H37'));
		expect(img.domHints.tagName).toBe('img');
		expect(img.domHints.classList).toEqual(['card__media', 'hero']);
		expect(img.domHints.idAttr).toBeNull();
		expect(img.domHints.attrs.src).toBe('/hero.jpg');

		const cta = home.violations.find((v) => v.id === 'color-contrast');
		expect(cta.domHints.tagName).toBe('a');
		expect(cta.domHints.idAttr).toBe('cta');
		expect(cta.domHints.classList).toEqual(['wp-block-acme-cta']);
		expect(cta.domHints.attrs.href).toBe('/buy');
	});

	test('honours a custom standard label', () => {
		expect(normalizeA11y(RAW, { standard: 'WCAG2AAA' }).standard).toBe(
			'WCAG2AAA'
		);
	});

	test('tolerates missing or malformed results', () => {
		expect(normalizeA11y({}).summary.urls).toBe(0);
		expect(normalizeA11y(null).results).toEqual([]);
		expect(normalizeA11y({ results: { '/x': 'nope' } }).results).toEqual([
			{ url: '/x', scanError: null, violations: [] },
		]);
	});

	test('a load failure becomes scanError, not a violation', () => {
		const rep = normalizeA11y({
			results: {
				'http://localhost:8888/': [
					{
						message:
							'net::ERR_CONNECTION_REFUSED at http://localhost:8888/',
					},
				],
			},
		});
		expect(rep.summary).toEqual({
			urls: 1,
			violations: 0,
			errors: 0,
			warnings: 0,
			notices: 0,
			passedUrls: 0,
			failedUrls: 1,
		});
		expect(rep.results[0].scanError).toMatch(/ERR_CONNECTION_REFUSED/);
		expect(rep.results[0].violations).toEqual([]);
	});
});

describe('parseWcagCriterion', () => {
	test('pulls the dotted criterion from an HTMLCS code', () => {
		expect(
			parseWcagCriterion('WCAG2AA.Principle2.Guideline2_4.2_4_4.H77')
		).toBe('2.4.4');
	});

	test('returns null when there is no criterion', () => {
		expect(parseWcagCriterion('image-alt')).toBeNull();
		expect(parseWcagCriterion('')).toBeNull();
		expect(parseWcagCriterion(undefined)).toBeNull();
	});
});

describe('extractDomHints', () => {
	test('falls back to the selector tag when context has no opening tag', () => {
		const hints = extractDomHints('', 'html > body > main > button.cta');
		expect(hints.tagName).toBe('button');
		expect(hints.classList).toEqual([]);
	});

	test('captures aria attributes', () => {
		const hints = extractDomHints(
			'<div role="button" aria-label="Close"></div>',
			'div'
		);
		expect(hints.tagName).toBe('div');
		expect(hints.attrs.role).toBe('button');
		expect(hints.attrs['aria-label']).toBe('Close');
	});
});

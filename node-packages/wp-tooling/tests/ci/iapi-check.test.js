'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	checkIapi,
	scanText,
	runCli,
	formatSummary,
	IapiCheckError,
	RULES,
} = require('../../src/ci/iapi-check');
const { annotation } = require('../../src/ci/coverage-gate/render');

const PROJECT = path.join(__dirname, 'fixtures', 'iapi-check', 'project');

const GIT_ENV = {
	...process.env,
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_CONFIG_GLOBAL: os.devNull,
};

const TEMP_DIRS = [];

function tempDir(prefix) {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
	TEMP_DIRS.push(dir);
	return dir;
}

afterAll(() => {
	for (const dir of TEMP_DIRS) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function write(root, rel, body) {
	const p = path.join(root, rel);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, body);
}

// Copy the fixture project to `dest`.
function copyProject(dest) {
	fs.cpSync(PROJECT, dest, { recursive: true });
	return dest;
}

/** A git repo whose `plugin/` subdirectory holds the fixture project. */
function makeRepo() {
	const root = tempDir('iapi-repo-');
	execFileSync('git', ['init', '-q'], { cwd: root, env: GIT_ENV });
	copyProject(path.join(root, 'plugin'));
	return root;
}

function captureOutput() {
	const out = [];
	const err = [];
	const o = jest
		.spyOn(process.stdout, 'write')
		.mockImplementation((s) => out.push(String(s)) || true);
	const e = jest
		.spyOn(process.stderr, 'write')
		.mockImplementation((s) => err.push(String(s)) || true);
	return {
		stdout: () => out.join(''),
		stderr: () => err.join(''),
		restore: () => {
			o.mockRestore();
			e.mockRestore();
		},
	};
}

// Temp `$GITHUB_OUTPUT` / `$GITHUB_STEP_SUMMARY`, passed through the env seam.
function githubEnv(extra = {}) {
	const dir = tempDir('iapi-gh-');
	const env = {
		GITHUB_OUTPUT: path.join(dir, 'out'),
		GITHUB_STEP_SUMMARY: path.join(dir, 'summary'),
		...extra,
	};
	return {
		env,
		output: () => fs.readFileSync(env.GITHUB_OUTPUT, 'utf8'),
		summary: () => fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'),
	};
}

// `[ rule, column ]` pairs for one scanned snippet.
const hits = (text, file = 'render.php') =>
	scanText(text, file).map((f) => [f.rule, f.column]);

/** Every finding the fixture project holds, in report order. */
const EXPECTED = [
	['blocks/legacy/render.php', 9, 2, 'ignore-directive'],
	['blocks/legacy/render.php', 10, 2, 'lifecycle-double-hyphen-id'],
	['blocks/legacy/render.php', 11, 2, 'lifecycle-double-hyphen-id'],
	['blocks/legacy/render.php', 12, 2, 'lifecycle-double-hyphen-id'],
	['blocks/legacy/render.php', 13, 2, 'event-double-hyphen-id'],
	['blocks/legacy/render.php', 14, 24, 'negated-function'],
	['blocks/legacy/render.php', 15, 25, 'negated-function'],
	['blocks/legacy/render.php', 17, 22, 'event-double-hyphen-id'],
	['blocks/legacy/view.js', 11, 11, 'router-state-navigation'],
	['blocks/legacy/view.js', 11, 44, 'router-state-navigation'],
	['patterns/hero.php', 9, 3, 'lifecycle-double-hyphen-id'],
	['patterns/hero.php', 10, 29, 'negated-function'],
	['patterns/hero.php', 12, 38, 'lifecycle-double-hyphen-id'],
	['src/Menu.tsx', 5, 4, 'event-double-hyphen-id'],
	['src/Menu.tsx', 6, 28, 'negated-function'],
	['src/Menu.tsx', 7, 14, 'lifecycle-double-hyphen-id'],
	['templates/single.html', 2, 63, 'event-double-hyphen-id'],
];

const positions = (result) =>
	result.findings.map((f) => [f.file, f.line, f.column, f.rule]);

test('@rtcamp/wp-tooling/ci exposes checkIapi, scanIapiText, IapiCheckError and the rules', () => {
	const ci = require('../../src/ci');
	expect(ci.checkIapi).toBe(checkIapi);
	expect(ci.scanIapiText).toBe(scanText);
	expect(new ci.IapiCheckError('x')).toBeInstanceOf(Error);
	expect(ci.IAPI_RULES.map((rule) => [rule.id, rule.severity])).toEqual([
		['ignore-directive', 'error'],
		['lifecycle-double-hyphen-id', 'error'],
		['event-double-hyphen-id', 'error'],
		['negated-function', 'error'],
		['router-state-navigation', 'warning'],
	]);
	expect(ci.IAPI_RULES).toBe(RULES);
});

describe('scanText: ignore-directive', () => {
	test('flags the bare attribute, in markup, PHP strings and selectors', () => {
		expect(hits('<div data-wp-ignore>')).toEqual([['ignore-directive', 6]]);
		expect(hits("$a = array( 'data-wp-ignore' => '' );")).toEqual([
			['ignore-directive', 14],
		]);
		expect(hits("q('[data-wp-ignore]')", 'a.js')).toEqual([
			['ignore-directive', 5],
		]);
	});

	test('does not flag longer names', () => {
		expect(
			hits('<b data-wp-ignore-me data-wp-ignored x-data-wp-ignore>')
		).toEqual([]);
	});
});

describe('scanText: lifecycle-double-hyphen-id', () => {
	test.each([
		['data-wp-init--setup', 'data-wp-init---setup'],
		['data-wp-watch--logger', 'data-wp-watch---logger'],
		['data-wp-run--effect', 'data-wp-run---effect'],
		['data-wp-watch--a---b', 'data-wp-watch---a---b'],
	])('%s → %s', (name, fix) => {
		const [finding] = scanText(`<div ${name}="callbacks.x">`, 'a.html');
		expect(finding).toMatchObject({
			rule: 'lifecycle-double-hyphen-id',
			severity: 'error',
			column: 6,
			match: name,
			replacement: fix,
		});
		expect(finding.message).toContain(`Use ${fix}.`);
		expect(finding.message).toContain('this callback never runs');
	});

	test.each([
		["echo 'data-wp-watch--' . $id;", 7],
		['echo "data-wp-watch--{$id}";', 7],
		['echo "data-wp-run--$id";', 7],
		["sprintf( 'data-wp-init--%s', $id );", 11],
		['const a = `data-wp-watch--${ id }`;', 12],
		["const a = 'data-wp-run--' + id;", 12],
		[
			'<div data-wp-watch--<?php echo esc_attr( $id ); ?>="callbacks.x">',
			6,
		],
		['<div data-wp-init--<?= $id ?>="callbacks.x">', 6],
	])('flags a unique ID built at run time: %s', (source, column) => {
		const [finding] = scanText(source, 'a.php');
		expect(finding).toMatchObject({
			rule: 'lifecycle-double-hyphen-id',
			column,
		});
		expect(finding.message).toMatch(/Use data-wp-\w+--- before the ID\.$/);
	});

	test.each([
		'<div data-wp-watch---logger data-wp-init---a data-wp-run---b>',
		'<div data-wp-watch data-wp-init="callbacks.x" data-wp-run>',
		'// data-wp-watch--[unique-id] in documentation',
		'<div data-wp-router-region="acme" data-wp-initial--x data-wp-watchful--y>',
		'<div data-wp-watch--="callbacks.x">',
		'<div data-wp-watch---<?php echo $id; ?>="callbacks.x">',
		// A directive with no ID: the runtime reads a null suffix and runs it.
		"$p->set_attribute( 'data-wp-watch--', 'callbacks.log' );",
	])('does not flag %s', (source) => {
		expect(hits(source)).toEqual([]);
	});
});

describe('scanText: event-double-hyphen-id', () => {
	test.each([
		['data-wp-on--click--plugin-a', 'data-wp-on--click---plugin-a'],
		['data-wp-on--my-event--id', 'data-wp-on--my-event---id'],
		['data-wp-on-window--resize--a', 'data-wp-on-window--resize---a'],
		[
			'data-wp-on-document--keydown--esc',
			'data-wp-on-document--keydown---esc',
		],
		['data-wp-on--click--a---b', 'data-wp-on--click---a---b'],
	])('%s → %s', (name, fix) => {
		const [finding] = scanText(`<b ${name}="actions.a">`, 'a.html');
		expect(finding).toMatchObject({
			rule: 'event-double-hyphen-id',
			column: 4,
			match: name,
			replacement: fix,
		});
		expect(finding.message).toContain(`Use ${fix}.`);
	});

	test('the message names the event 7.2 listens for', () => {
		const [finding] = scanText('<b data-wp-on--click--track>', 'a.html');
		expect(finding.message).toBe(
			'data-wp-on--click--track uses a two-hyphen unique ID. WordPress 7.2 reads click--track as the event name, so the handler no longer fires on click. Use data-wp-on--click---track.'
		);
	});

	test('flags a unique ID built at run time', () => {
		const [finding] = scanText(
			"echo 'data-wp-on--click--' . $id;",
			'a.php'
		);
		expect(finding).toMatchObject({
			rule: 'event-double-hyphen-id',
			column: 7,
			replacement: 'data-wp-on--click---',
		});
		expect(finding.message).toContain(
			'reads click-- plus the ID as the event name'
		);
	});

	test('flags a unique ID printed with an inline PHP tag', () => {
		const [finding] = scanText(
			'<div data-wp-on--click--<?= $id ?>="actions.x">',
			'render.php'
		);
		expect(finding).toMatchObject({
			rule: 'event-double-hyphen-id',
			column: 6,
			replacement: 'data-wp-on--click---',
		});
	});

	test.each([
		'data-wp-on--click---plugin-a',
		'data-wp-on-window--resize---x',
		'data-wp-on-document--keydown---y',
		'data-wp-on-async--click--legacy',
		'data-wp-on-async-window--resize--x',
		'data-wp-on-async-document--keyup--z',
		'data-wp-on--my-custom-event',
		'data-wp-on--click',
		'data-wp-bind--hidden',
		'data-wp-class--is-open',
		'data-wp-context--ns',
		'data-wp-on--[event]--[id]',
	])('does not flag %s', (name) => {
		expect(hits(`<b ${name}="actions.a">`)).toEqual([]);
	});
});

describe('scanText: negated-function', () => {
	test.each([
		['<b data-wp-bind--hidden="!actions.isOpen">', 26, '!actions.isOpen'],
		[
			"<b data-wp-class--on='ns::!callbacks.isOn'>",
			23,
			'ns::!callbacks.isOn',
		],
		[
			'<b data-wp-bind--hidden="acme/menu::!actions.isOpen">',
			26,
			'acme/menu::!actions.isOpen',
		],
		[
			'echo "<b data-wp-bind--hidden=\\"!actions.isOpen\\">";',
			33,
			'!actions.isOpen',
		],
		["$a[ 'data-wp-bind--hidden' ] = '!actions.x';", 33, '!actions.x'],
		["'data-wp-bind--hidden' => '!actions.x',", 28, '!actions.x'],
		["$a['data-wp-bind--hidden'] = '!actions.x';", 31, '!actions.x'],
		["{ 'data-wp-bind--hidden': '!actions.x' }", 28, '!actions.x'],
		[
			"$p->set_attribute( 'data-wp-x', '!callbacks.y' );",
			34,
			'!callbacks.y',
		],
		["<i data-wp-bind--hidden={ '!actions.x' } />", 28, '!actions.x'],
	])('flags %s at the value', (source, column, value) => {
		const [finding] = scanText(source, 'a.php');
		expect(finding).toMatchObject({
			rule: 'negated-function',
			column,
			match: value,
			replacement: null,
		});
		expect(finding.message).toContain('the value is undefined');
		expect(finding.message).toContain('derived state');
	});

	test('a value on the line after its attribute is located on that line', () => {
		const [finding] = scanText(
			"array(\n\t'data-wp-bind--hidden'\n\t\t=> '!actions.x',\n);",
			'a.php'
		);
		expect(finding).toMatchObject({ line: 3, column: 7 });
	});

	test.each([
		'<b data-wp-bind--hidden="!state.isOpen">',
		'<b data-wp-class--x="!context.isClosed">',
		'<b data-wp-bind--x="ns::!state.y">',
		'<b data-wp-on--click="actions.toggle">',
		'<b data-wp-bind--hidden="!!actions.x">',
		'<b data-wp-bind--hidden=" !actions.x">',
		'<b data-wp-bind--hidden="!actionsList.x">',
		'<b class="!actions.x">',
		// The namespace must come first; this form never resolved, before 7.2 too.
		'<b data-wp-bind--hidden="!acme/menu::actions.isOpen">',
	])('does not flag %s', (source) => {
		expect(hits(source)).toEqual([]);
	});
});

describe('scanText: router-state-navigation', () => {
	const ROUTER =
		"const { state } = store( 'core/router' );\nif ( state.navigation.hasStarted || state?.navigation ) {}\n";

	test('flags state.navigation as a warning in a file that reads core/router', () => {
		expect(
			scanText(ROUTER, 'view.js').map((f) => [
				f.rule,
				f.severity,
				f.line,
				f.column,
			])
		).toEqual([
			['router-state-navigation', 'warning', 2, 6],
			['router-state-navigation', 'warning', 2, 37],
		]);
	});

	test('also when the store comes from @wordpress/interactivity-router', () => {
		const text =
			"const { state } = await import( '@wordpress/interactivity-router' );\nstate.navigation.hasFinished;";
		expect(hits(text, 'view.mjs')).toEqual([
			['router-state-navigation', 1],
		]);
	});

	test.each(['view.ts', 'view.tsx', 'view.jsx', 'view.cjs'])(
		'reads %s',
		(file) => {
			expect(hits(ROUTER, file)).toHaveLength(2);
		}
	);

	test('ignores PHP and HTML, other stores, and other properties', () => {
		expect(hits(ROUTER, 'render.php')).toEqual([]);
		expect(hits(ROUTER, 'index.html')).toEqual([]);
		expect(hits('state.navigation.isOpen;', 'menu.js')).toEqual([]);
		expect(
			hits(
				"store( 'core/router' );\nstate.navigating; state.navigationMenu; mystate.navigation;",
				'view.js'
			)
		).toEqual([]);
	});

	test('follows the name core/router state is bound to, not another store', () => {
		const text = [
			"const { state: router } = store( 'core/router' );",
			"const { state } = store( 'acme/menu' );",
			'state.navigation.isOpen; router.navigation.hasStarted;',
		].join('\n');
		const findings = scanText(text, 'view.js');
		expect(findings.map((f) => [f.match, f.line, f.column])).toEqual([
			['router.navigation', 3, 26],
		]);
		expect(findings[0].message).toContain('Read router.navigating instead');
	});

	test.each([
		[
			"import { state as rs } from '@wordpress/interactivity-router';\nrs.navigation.x;",
			'rs.navigation',
		],
		[
			"const router = store( 'core/router' );\nrouter.state.navigation.x;",
			'router.state.navigation',
		],
		[
			"store( 'core/router' ).state.navigation.x;",
			"store( 'core/router' ).state.navigation",
		],
	])('reads router state bound as in %s', (text, match) => {
		expect(scanText(text, 'view.js').map((f) => f.match)).toEqual([match]);
	});

	test('says when to switch: state.navigating needs WordPress 7.2', () => {
		const [finding] = scanText(ROUTER, 'view.js');
		expect(finding.message).toContain(
			'once the plugin requires WordPress 7.2'
		);
		expect(finding.message).toContain('safe to leave');
	});
});

describe('scanText: positions and file types', () => {
	test('lines and columns are 1-based, across CRLF line ends and a byte-order mark', () => {
		const text =
			'﻿<div data-wp-ignore>\r\n\t<p data-wp-watch--x>\r\n</div>';
		expect(
			scanText(text, 'a.html').map((f) => [f.rule, f.line, f.column])
		).toEqual([
			['ignore-directive', 1, 6],
			['lifecycle-double-hyphen-id', 2, 5],
		]);
	});

	test('findings on one line are ordered by column, ties by rule order', () => {
		const text =
			'<b data-wp-on--click--x="!actions.y" data-wp-ignore data-wp-watch--z>';
		expect(hits(text)).toEqual([
			['event-double-hyphen-id', 4],
			['negated-function', 26],
			['ignore-directive', 38],
			['lifecycle-double-hyphen-id', 53],
		]);
	});

	test.each(['style.css', 'readme.txt', 'block.json', 'README.md'])(
		'does not read %s',
		(file) => {
			expect(hits('<div data-wp-ignore data-wp-watch--x>', file)).toEqual(
				[]
			);
		}
	);

	test.each([
		'a.php',
		'a.html',
		'a.js',
		'a.jsx',
		'a.ts',
		'a.tsx',
		'a.mjs',
		'a.cjs',
		'A.PHP',
	])('reads %s', (file) => {
		expect(hits('<div data-wp-ignore>', file)).toHaveLength(1);
	});
});

describe('scanText: comments', () => {
	test.each([
		['// data-wp-watch--x and data-wp-ignore', 'a.js'],
		['\t\t// Bound via `data-wp-init--autoplay`.', 'a.js'],
		[' * The deprecated `state.navigation.*` is not used.', 'a.js'],
		['/* data-wp-on--click--x="!actions.y" */', 'a.js'],
		['# data-wp-ignore', 'a.php'],
		['<!-- data-wp-ignore -->', 'a.html'],
		['\t<!-- <div data-wp-watch--x> -->', 'a.html'],
	])('skips a commented-out line: %s', (line, file) => {
		const text = `store( 'core/router' );\n${line}\n`;
		expect(hits(text, file)).toEqual([]);
	});

	test.each([
		['foo(); // data-wp-ignore', 11],
		['/* old */ <div data-wp-ignore>', 16],
		['<!-- wp:html --><div data-wp-ignore>', 22],
		['<a href="https://example.com" data-wp-ignore>', 31],
		["#[Attr] function f() { return 'data-wp-ignore'; }", 32],
		[' */ <div data-wp-ignore>', 10],
	])('still reports code on the line: %s', (line, column) => {
		expect(hits(line, 'a.php')).toEqual([['ignore-directive', column]]);
	});
});

describe('checkIapi on the fixture project', () => {
	const result = checkIapi({ root: PROJECT });

	test('finds every outdated usage, by file, line and column', () => {
		expect(positions(result)).toEqual(EXPECTED);
		expect(result).toMatchObject({
			filesScanned: 8,
			errors: 15,
			warnings: 2,
		});
	});

	test('each line and column points at the matched text', () => {
		for (const finding of result.findings) {
			const line = fs
				.readFileSync(path.join(PROJECT, finding.file), 'utf8')
				.split('\n')[finding.line - 1];
			expect(
				line.slice(
					finding.column - 1,
					finding.column - 1 + finding.match.length
				)
			).toBe(finding.match);
		}
	});

	test('the current-syntax files report nothing', () => {
		const files = new Set(result.findings.map((f) => f.file));
		expect(files.has('blocks/modern/render.php')).toBe(false);
		expect(files.has('blocks/modern/view.js')).toBe(false);
		expect(files.has('blocks/menu/view.js')).toBe(false);
	});

	test('skips dependencies, git metadata, build output, minified bundles and symlinks', () => {
		const root = copyProject(tempDir('iapi-skip-'));
		const legacy = '<div data-wp-ignore data-wp-watch--x></div>\n';
		for (const rel of [
			'node_modules/pkg/render.php',
			'blocks/legacy/node_modules/pkg/view.js',
			'vendor/acme/lib/render.php',
			'.git/hooks/pre-commit.js',
			'build/view.js',
			'assets/build/view.js',
			'blocks/legacy/build/render.php',
			'dist/view.js',
			'assets/js/bundle.min.js',
		]) {
			write(root, rel, legacy);
		}
		fs.symlinkSync(
			path.join(root, 'blocks/legacy'),
			path.join(root, 'linked')
		);
		fs.symlinkSync(
			path.join(root, 'blocks/legacy/render.php'),
			path.join(root, 'linked.php')
		);
		const scanned = checkIapi({ root });
		expect(positions(scanned)).toEqual(EXPECTED);
		expect(scanned.filesScanned).toBe(8);
	});

	test('the ignore pattern drops matching relative paths', () => {
		const scanned = checkIapi({
			root: PROJECT,
			ignore: /^templates\/|\.tsx$/,
		});
		expect(positions(scanned)).toEqual(
			EXPECTED.filter(
				([file]) =>
					file !== 'templates/single.html' && file !== 'src/Menu.tsx'
			)
		);
		expect(scanned.filesScanned).toBe(6);
	});

	test('an ignore pattern with the g flag skips every match, not every other one', () => {
		// blocks/legacy/render.php and blocks/legacy/view.js are listed one after
		// the other: a kept lastIndex made the second test start past the anchor.
		const scanned = checkIapi({ root: PROJECT, ignore: /^blocks\//g });
		expect(
			positions(scanned).filter(([file]) => file.startsWith('blocks/'))
		).toEqual([]);
	});

	test('a missing or non-directory root throws IapiCheckError', () => {
		expect(() => checkIapi({ root: path.join(PROJECT, 'nope') })).toThrow(
			IapiCheckError
		);
		expect(() =>
			checkIapi({ root: path.join(PROJECT, 'patterns/hero.php') })
		).toThrow(/is a file; expected a directory/);
	});
});

describe('formatSummary', () => {
	test('lists at most 200 rows and counts the rest', () => {
		const findings = Array.from({ length: 203 }, (_, i) => ({
			file: 'a.php',
			line: i + 1,
			column: 1,
			rule: 'ignore-directive',
			severity: 'error',
			message: 'm',
		}));
		const summary = formatSummary({
			filesScanned: 1,
			findings,
			errors: 203,
			warnings: 0,
		});
		expect(summary.match(/^\| `a\.php` \|/gm)).toHaveLength(200);
		expect(summary).toContain('3 more findings not listed');
	});

	test('a crafted message cannot break the table', () => {
		const summary = formatSummary({
			filesScanned: 1,
			findings: [
				{
					file: 'a|b.php',
					line: 1,
					column: 1,
					rule: 'ignore-directive',
					severity: 'error',
					message: 'x | y\nz',
				},
			],
			errors: 1,
			warnings: 0,
		});
		expect(summary).toContain(
			'| `a\\|b.php` | 1:1 | error | `ignore-directive` | x \\| y\\x0az |'
		);
	});
});

test('annotation() carries col and an escaped title', () => {
	expect(
		annotation('error', 'msg', {
			file: 'a,b.php',
			line: 3,
			col: 7,
			title: 'iapi-check: rule',
		})
	).toBe('::error file=a%2Cb.php,line=3,col=7,title=iapi-check%3A rule::msg');
});

describe('runCli', () => {
	let repo;
	let io;
	beforeAll(() => {
		repo = makeRepo();
	});
	beforeEach(() => {
		io = captureOutput();
	});
	afterEach(() => {
		io.restore();
	});

	const plugin = () => path.join(repo, 'plugin');
	const args = (...rest) => ['--working-dir', plugin(), ...rest];

	/** Lines the runner would treat as workflow commands. */
	const workflowCommands = () =>
		io
			.stdout()
			.split('\n')
			.filter((line) => line.trimStart().startsWith('::'));

	test('text mode groups findings by file, ends with the count and exits 1', () => {
		expect(runCli(args(), { env: {} })).toBe(1);
		const lines = io.stdout().trimEnd().split('\n');
		expect(lines[0]).toBe('  - blocks/legacy/render.php');
		expect(lines[1]).toBe(
			'      9:2  error    ignore-directive  data-wp-ignore is removed in WordPress 7.2: the element and its descendants now hydrate like any other element. Remove the attribute.'
		);
		expect(lines).toContain('  - templates/single.html');
		expect(lines.filter((line) => line.startsWith('  - '))).toHaveLength(5);
		expect(lines.at(-1)).toBe(
			'iapi-check: 15 errors and 2 warnings in 5 files (8 files scanned).'
		);
		expect(workflowCommands()).toEqual([]);
	});

	test('json mode prints one object with paths relative to --working-dir', () => {
		expect(runCli(args('--output', 'json'), { env: {} })).toBe(1);
		const report = JSON.parse(io.stdout());
		expect(report).toMatchObject({
			filesScanned: 8,
			errors: 15,
			warnings: 2,
		});
		expect(
			report.findings.map((f) => [f.file, f.line, f.column, f.rule])
		).toEqual(EXPECTED);
		expect(report.findings[1]).toEqual({
			file: 'blocks/legacy/render.php',
			line: 10,
			column: 2,
			rule: 'lifecycle-double-hyphen-id',
			severity: 'error',
			message:
				'data-wp-watch--logger uses a two-hyphen unique ID. WordPress 7.2 skips data-wp-watch directives that have a suffix, so this callback never runs. Use data-wp-watch---logger.',
			match: 'data-wp-watch--logger',
			replacement: 'data-wp-watch---logger',
		});
	});

	test('github mode annotates repo-root paths and writes outputs and a summary', () => {
		const gh = githubEnv();
		expect(runCli(args('--output', 'github'), gh)).toBe(1);
		const commands = workflowCommands();
		expect(commands).toHaveLength(17);
		expect(commands[0]).toBe(
			'::error file=plugin/blocks/legacy/render.php,line=9,col=2,title=iapi-check%3A ignore-directive::data-wp-ignore is removed in WordPress 7.2: the element and its descendants now hydrate like any other element. Remove the attribute.'
		);
		expect(commands).toContain(
			'::warning file=plugin/blocks/legacy/view.js,line=11,col=11,title=iapi-check%3A router-state-navigation::state.navigation from the core/router store is deprecated since WordPress 7.0, and a later release removes direct access. Read state.navigating instead once the plugin requires WordPress 7.2 (@wordpress/interactivity-router 2.57.0); until then this warning is safe to leave.'
		);
		expect(commands.filter((c) => c.startsWith('::error '))).toHaveLength(
			15
		);
		expect(gh.output()).toBe('findings=17\nerrors=15\nwarnings=2\n');
		const summary = gh.summary();
		expect(summary).toContain(
			'### Interactivity API check for WordPress 7.2'
		);
		expect(summary).toContain(
			'❌ 15 errors and 2 warnings in 5 files (8 files scanned).'
		);
		expect(summary).toContain(
			'[WordPress/gutenberg#84098](https://github.com/WordPress/gutenberg/pull/84098)'
		);
		expect(summary).toContain(
			'| `templates/single.html` | 2:63 | error | `event-double-hyphen-id` | data-wp-on-window--resize--layout uses a two-hyphen unique ID.'
		);
		expect(io.stdout()).toContain(
			'iapi-check: 15 errors and 2 warnings in 5 files (8 files scanned).'
		);
	});

	test('annotation paths are the same whether --working-dir is the repo root or a subdirectory', () => {
		const fromSub = githubEnv();
		runCli(args('--output', 'github'), fromSub);
		const sub = workflowCommands();
		io.restore();
		io = captureOutput();
		const fromRoot = githubEnv();
		runCli(['--working-dir', repo, '--output', 'github'], fromRoot);
		expect(workflowCommands()).toEqual(sub);
		expect(fromRoot.summary()).toContain(
			'| `plugin/blocks/legacy/render.php` | 9:2 |'
		);
	});

	test('outside a git checkout, annotation paths are relative to $GITHUB_WORKSPACE', () => {
		const workspace = tempDir('iapi-ws-');
		copyProject(path.join(workspace, 'themes', 'acme'));
		const ceiling = process.env.GIT_CEILING_DIRECTORIES;
		process.env.GIT_CEILING_DIRECTORIES = path.dirname(workspace);
		try {
			expect(
				runCli(
					[
						'--working-dir',
						path.join(workspace, 'themes', 'acme'),
						'--output',
						'github',
					],
					githubEnv({ GITHUB_WORKSPACE: workspace })
				)
			).toBe(1);
		} finally {
			if (ceiling === undefined) {
				delete process.env.GIT_CEILING_DIRECTORIES;
			} else {
				process.env.GIT_CEILING_DIRECTORIES = ceiling;
			}
		}
		expect(workflowCommands()[0]).toMatch(
			/^::error file=themes\/acme\/blocks\/legacy\/render\.php,line=9,col=2,/
		);
	});

	test('--soft-fail exits 0 and annotates every finding as a warning', () => {
		const gh = githubEnv();
		expect(runCli(args('--output', 'github', '--soft-fail'), gh)).toBe(0);
		const commands = workflowCommands();
		expect(commands).toHaveLength(17);
		expect(commands.every((c) => c.startsWith('::warning '))).toBe(true);
		expect(io.stderr()).toContain(
			'iapi-check: --soft-fail set; exiting 0 despite 15 errors.'
		);
		expect(gh.output()).toBe('findings=17\nerrors=15\nwarnings=2\n');
		expect(gh.summary()).toContain(
			'Reported as warnings because of --soft-fail.'
		);
	});

	test('--soft-fail also exits 0 in text and json mode', () => {
		expect(runCli(args('--soft-fail'), { env: {} })).toBe(0);
		expect(
			runCli(args('--output', 'json', '--soft-fail'), { env: {} })
		).toBe(0);
	});

	test('--ignore drops files and the counts follow', () => {
		const gh = githubEnv();
		expect(
			runCli(
				args(
					'--output',
					'github',
					'--ignore',
					'^(blocks|patterns|src)/'
				),
				gh
			)
		).toBe(1);
		expect(gh.output()).toBe('findings=1\nerrors=1\nwarnings=0\n');
		expect(workflowCommands()).toEqual([
			expect.stringMatching(
				/^::error file=plugin\/templates\/single\.html,line=2,col=63,/
			),
		]);
	});

	test('warnings alone exit 0', () => {
		const gh = githubEnv();
		expect(
			runCli(
				args(
					'--output',
					'github',
					'--ignore',
					'^(?!blocks/legacy/view\\.js$)'
				),
				gh
			)
		).toBe(0);
		expect(gh.output()).toBe('findings=2\nerrors=0\nwarnings=2\n');
		expect(gh.summary()).toContain(
			'⚠️ 0 errors and 2 warnings in 1 file (1 file scanned).'
		);
	});

	test('a clean project exits 0 with an all-clear summary', () => {
		const gh = githubEnv();
		expect(
			runCli(
				args(
					'--output',
					'github',
					'--ignore',
					'legacy|patterns|src|templates'
				),
				gh
			)
		).toBe(0);
		expect(workflowCommands()).toEqual([]);
		expect(gh.output()).toBe('findings=0\nerrors=0\nwarnings=0\n');
		expect(gh.summary()).toBe(
			'### Interactivity API check for WordPress 7.2\n\n✅ No findings (3 files scanned).\n\n'
		);
		expect(io.stdout()).toBe(
			'iapi-check: No findings (3 files scanned).\n'
		);
	});

	test('--dry-run previews files and annotations without emitting workflow commands', () => {
		expect(
			runCli(args('--output', 'github', '--dry-run'), { env: {} })
		).toBe(1);
		expect(io.stdout()).toContain(
			'[dry-run] would emit: ::error file=plugin/blocks/legacy/render.php,line=9,col=2,'
		);
		expect(io.stdout()).toContain(
			'[dry-run] would append to $GITHUB_OUTPUT:\nfindings=17\nerrors=15\nwarnings=2\n'
		);
		expect(io.stdout()).toContain(
			'[dry-run] would append to $GITHUB_STEP_SUMMARY:\n### Interactivity API check'
		);
		expect(workflowCommands()).toEqual([]);
	});

	test('github mode warns when $GITHUB_OUTPUT is unset', () => {
		expect(runCli(args('--output', 'github'), { env: {} })).toBe(1);
		expect(io.stderr()).toContain(
			'iapi-check: --output github requested but $GITHUB_OUTPUT is unset; nothing written.'
		);
	});

	test('empty flag values count as not given', () => {
		expect(runCli(args('--output', '', '--ignore', ''), { env: {} })).toBe(
			1
		);
		expect(io.stdout()).toContain('in 5 files (8 files scanned).');
	});

	test('a missing --working-dir exits 2', () => {
		expect(
			runCli(['--working-dir', path.join(repo, 'nope')], { env: {} })
		).toBe(2);
		expect(io.stderr()).toMatch(
			/^iapi-check: cannot read --working-dir ".*nope" \(ENOENT\); expected an existing directory\n$/
		);
	});

	test('a missing --working-dir under github --soft-fail: warning annotation, exit 0', () => {
		expect(
			runCli(
				[
					'--working-dir',
					path.join(repo, 'nope'),
					'--output',
					'github',
					'--soft-fail',
				],
				githubEnv()
			)
		).toBe(0);
		expect(workflowCommands()).toEqual([
			expect.stringMatching(
				/^::warning::iapi-check: cannot read --working-dir/
			),
		]);
	});

	test.each([
		[['--output', 'xml'], 'invalid --output "xml"'],
		[['--ignore', '('], 'invalid --ignore regex "("'],
		[['--working-dir'], 'missing value for --working-dir'],
		[['--ignore', '--soft-fail'], 'missing value for --ignore'],
		[['--bogus'], 'unknown argument: --bogus'],
		[['plugin'], 'unknown argument: plugin'],
	])('usage error exits 2: %j', (argv, reason) => {
		expect(runCli(argv, { env: {} })).toBe(2);
		expect(io.stderr()).toContain(reason);
	});

	test('--help explains every rule, the release date and the source', () => {
		expect(runCli(['--help'])).toBe(0);
		const help = io.stdout();
		for (const rule of RULES) {
			expect(help).toContain(rule.id);
		}
		expect(help).toContain('WordPress 7.2 (due 2026-12-09)');
		expect(help).toContain(
			'https://github.com/WordPress/gutenberg/pull/84098'
		);
		expect(help).toContain('--soft-fail');
		expect(runCli(['-h'])).toBe(0);
	});
});

describe('runCli with hostile file names', () => {
	let io;
	beforeEach(() => {
		io = captureOutput();
	});
	afterEach(() => {
		io.restore();
	});

	test('a crafted path cannot start a workflow command or break the summary', () => {
		const root = tempDir('iapi-names-');
		write(root, 'x\n::error::pwned.php', '<div data-wp-ignore>\n');
		write(root, 'a|b`c.php', '<div data-wp-ignore>\n');
		const gh = githubEnv();
		expect(runCli(['--working-dir', root, '--output', 'github'], gh)).toBe(
			1
		);
		const commands = io
			.stdout()
			.split('\n')
			.filter((line) => line.trimStart().startsWith('::'));
		expect(commands).toEqual([
			expect.stringMatching(/^::error file=a\|b`c\.php,line=1,col=6,/),
			expect.stringMatching(
				/^::error file=x\\x0a%3A%3Aerror%3A%3Apwned\.php,line=1,col=6,/
			),
		]);
		expect(io.stdout()).toContain('  - x\\x0a::error::pwned.php');
		const summary = gh.summary();
		expect(summary).toContain('| ``a\\|b`c.php`` | 1:6 |');
		expect(summary).toContain('| `x\\x0a::error::pwned.php` | 1:6 |');
	});
});

'use strict';

const fs = require('fs');
const path = require('path');
const { applyUpdates } = require('../../src/version-monitor/updater');
const { copyFixture, cleanup } = require('./_helpers');

let dir;
const noLog = () => {};
const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

beforeEach(() => {
	dir = copyFixture('repo');
});
afterEach(() => {
	cleanup(dir);
});

describe('applyUpdates', () => {
	it('rewrites each of the six source types in place', () => {
		const updates = [
			{
				source: 'npm',
				file: 'package.json',
				package: 'lodash',
				currentValue: '^4.17.0',
				latestValue: '^4.17.21',
				is_major: false,
			},
			{
				source: 'node',
				file: 'package.json',
				package: 'node',
				currentValue: '>=22.11.0',
				latestValue: '>=22.13.1',
				is_major: false,
			},
			{
				source: 'actions',
				file: '.github/workflows/ci.yml',
				package: 'actions/setup-node',
				currentValue: 'v4.0.2',
				latestValue: 'v4.2.0',
				is_major: false,
			},
			{
				source: 'wp-cli',
				file: '.github/workflows/ci.yml',
				package: 'wp-cli',
				currentValue: '2.10.0',
				latestValue: '2.11.0',
				is_major: false,
			},
			{
				source: 'node',
				file: '.nvmrc',
				package: 'node',
				currentValue: '22.11.0',
				latestValue: '22.13.1',
				is_major: false,
			},
			{
				source: 'php',
				file: 'composer.json',
				package: 'php',
				currentValue: '>=8.1',
				latestValue: '>=8.3',
				is_major: false,
			},
			{
				source: 'container',
				file: 'Dockerfile',
				package: 'node',
				currentValue: '22.11.0',
				latestValue: '22.13.1',
				is_major: false,
			},
		];

		const result = applyUpdates(updates, { cwd: dir, log: noLog });

		expect(result.written).toHaveLength(7);
		expect(read('package.json')).toContain('"lodash": "^4.17.21"');
		expect(read('package.json')).toContain('"node": ">=22.13.1"');
		expect(read('.github/workflows/ci.yml')).toContain(
			'actions/setup-node@v4.2.0'
		);
		expect(read('.github/workflows/ci.yml')).toContain(
			'wp-cli/wp-cli:2.11.0'
		);
		expect(read('.nvmrc').trim()).toBe('22.13.1');
		expect(read('composer.json')).toContain('"php": ">=8.3"');
		expect(read('Dockerfile')).toContain('FROM node:22.13.1');
	});

	it('skips major bumps unless allowMajor is set', () => {
		const major = [
			{
				source: 'npm',
				file: 'package.json',
				package: 'jest',
				currentValue: '^29.0.0',
				latestValue: '^30.0.0',
				is_major: true,
			},
		];

		const skipped = applyUpdates(major, { cwd: dir, log: noLog });
		expect(skipped.written).toHaveLength(0);
		expect(skipped.skipped).toHaveLength(1);
		expect(read('package.json')).toContain('"jest": "^29.0.0"');

		const applied = applyUpdates(major, {
			cwd: dir,
			log: noLog,
			allowMajor: true,
		});
		expect(applied.written).toHaveLength(1);
		expect(read('package.json')).toContain('"jest": "^30.0.0"');
	});

	it('rewrites every occurrence of a duplicated scalar pin', () => {
		const wf = '.github/workflows/dup.yml';
		fs.writeFileSync(
			path.join(dir, wf),
			[
				'jobs:',
				'  a:',
				'    steps: [{ node-version: 22.11.0 }]',
				'  b:',
				'    steps: [{ node-version: 22.11.0 }]',
				'',
			].join('\n')
		);
		applyUpdates(
			[
				{
					source: 'node',
					file: wf,
					package: 'node',
					currentValue: '22.11.0',
					latestValue: '22.13.1',
					is_major: false,
				},
			],
			{ cwd: dir, log: noLog }
		);
		const out = fs.readFileSync(path.join(dir, wf), 'utf8');
		expect(out.match(/22\.11\.0/g)).toBeNull();
		expect((out.match(/22\.13\.1/g) || []).length).toBe(2);
	});

	it('writes nothing on a dry run', () => {
		const updates = [
			{
				source: 'node',
				file: '.nvmrc',
				package: 'node',
				currentValue: '22.11.0',
				latestValue: '22.13.1',
				is_major: false,
			},
		];
		const result = applyUpdates(updates, {
			cwd: dir,
			dryRun: true,
			log: noLog,
		});
		expect(result.dryRun).toBe(true);
		expect(result.written).toHaveLength(1);
		expect(read('.nvmrc').trim()).toBe('22.11.0');
	});

	it('records an update whose current value is not found as unmatched', () => {
		const updates = [
			{
				source: 'npm',
				file: 'package.json',
				package: 'not-installed',
				currentValue: '^1.0.0',
				latestValue: '^2.0.0',
				is_major: false,
			},
		];
		const result = applyUpdates(updates, { cwd: dir, log: noLog });
		expect(result.unmatched).toHaveLength(1);
		expect(result.written).toHaveLength(0);
	});
});

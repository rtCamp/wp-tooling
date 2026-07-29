'use strict';

const fs = require('fs');

jest.mock('../../src/version-monitor/config');
jest.mock('../../src/version-monitor/detect');
jest.mock('../../src/version-monitor/updater');

const { loadConfig } = require('../../src/version-monitor/config');
const { detect } = require('../../src/version-monitor/detect');
const { applyUpdates } = require('../../src/version-monitor/updater');
const { runCli } = require('../../src/version-monitor/cli');

let out;
let err;

beforeEach(() => {
	out = '';
	err = '';
	jest.spyOn(process.stdout, 'write').mockImplementation((s) => {
		out += s;
		return true;
	});
	jest.spyOn(process.stderr, 'write').mockImplementation((s) => {
		err += s;
		return true;
	});
});

describe('runCli arg handling', () => {
	it('prints usage and exits 0 on --help', async () => {
		expect(await runCli(['--help'])).toBe(0);
		expect(out).toContain('Usage: wp-tooling version-monitor');
	});

	it('exits 2 when no mode is given', async () => {
		expect(await runCli([])).toBe(2);
		expect(err).toContain('specify a mode');
	});

	it('exits 2 on mutually exclusive modes', async () => {
		expect(await runCli(['--detect', '--apply'])).toBe(2);
		expect(err).toContain('mutually exclusive');
	});

	it('exits 2 on an unknown argument', async () => {
		expect(await runCli(['--detect', '--bogus'])).toBe(2);
		expect(err).toContain('unknown argument');
	});
});

describe('runCli --detect', () => {
	it('loads config, runs detect, prints JSON', async () => {
		loadConfig.mockReturnValue({ sources: {}, policy: {} });
		detect.mockResolvedValue([{ source: 'npm', package: 'lodash' }]);
		expect(await runCli(['--detect'])).toBe(0);
		expect(JSON.parse(out)).toEqual([{ source: 'npm', package: 'lodash' }]);
	});

	it('exits 2 when the config is missing', async () => {
		loadConfig.mockImplementation(() => {
			throw new Error('version-monitor: config not found at "x"');
		});
		expect(await runCli(['--detect'])).toBe(2);
		expect(err).toContain('config not found');
	});

	it('exits 1 but still prints results when a detector errored', async () => {
		loadConfig.mockReturnValue({ sources: {}, policy: {} });
		detect.mockImplementation((config, opts) => {
			opts.errors.push('npm "lodash": network down');
			return Promise.resolve([]);
		});
		expect(await runCli(['--detect'])).toBe(1);
		expect(JSON.parse(out)).toEqual([]);
		expect(err).toContain('detector error(s)');
		expect(err).toContain('network down');
	});
});

describe('runCli --report / --apply (stdin)', () => {
	it('reads JSON from stdin and prints markdown for --report', async () => {
		jest.spyOn(fs, 'readFileSync').mockReturnValue(
			JSON.stringify([
				{
					source: 'node',
					file: '.nvmrc',
					package: 'node',
					currentValue: '22.11.0',
					latestValue: '22.13.1',
					is_major: false,
				},
			])
		);
		expect(await runCli(['--report'])).toBe(0);
		expect(out).toContain('## Monthly version monitor');
		expect(out).toContain('### Node (1)');
	});

	it('reads JSON from stdin and applies for --apply', async () => {
		const updates = [{ source: 'npm', file: 'package.json' }];
		jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(updates));
		applyUpdates.mockReturnValue({ written: updates, skipped: [] });
		expect(await runCli(['--apply', '--allow-major'])).toBe(0);
		expect(applyUpdates).toHaveBeenCalledWith(
			updates,
			expect.objectContaining({ allowMajor: true })
		);
	});

	it('exits 2 when stdin is not valid JSON', async () => {
		jest.spyOn(fs, 'readFileSync').mockReturnValue('not-json');
		expect(await runCli(['--apply'])).toBe(2);
		expect(err).toContain('not valid JSON');
	});
});

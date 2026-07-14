'use strict';

jest.mock('child_process');

const { spawnSync } = require('child_process');
const { runServerProfile, splitUrl } = require('../../src/perf/server-profile');

const SERVER = {
	command: [
		'npx',
		'wp-env',
		'run',
		'cli',
		'--env-cwd=wp-content/plugins/dummy-plugin',
		'--',
		'wp',
	],
	shim: 'server-profile.php',
	top: 15,
};

describe('splitUrl', () => {
	test('splits origin from path + query', () => {
		expect(splitUrl('http://localhost:8765/?p=1')).toEqual({
			origin: 'http://localhost:8765',
			pathAndQuery: '/?p=1',
		});
	});

	test('a bare root path has no query', () => {
		expect(splitUrl('http://localhost:8765/')).toEqual({
			origin: 'http://localhost:8765',
			pathAndQuery: '/',
		});
	});
});

describe('runServerProfile', () => {
	afterEach(() => {
		spawnSync.mockReset();
	});

	test('spawns the WP-CLI command with the documented argument order', () => {
		spawnSync.mockReturnValue({ stdout: '{}', stderr: '', status: 0 });
		runServerProfile(SERVER, 'http://localhost:8765/?p=1', {
			cwd: '/project',
		});
		const [command, args, opts] = spawnSync.mock.calls[0];
		expect(command).toBe('npx');
		expect(args).toEqual([
			'wp-env',
			'run',
			'cli',
			'--env-cwd=wp-content/plugins/dummy-plugin',
			'--',
			'wp',
			'eval-file',
			'server-profile.php',
			'/?p=1',
			'15',
			'--url=http://localhost:8765',
		]);
		expect(opts.cwd).toBe('/project');
	});

	test('parses a bare function map and captures the STDERR diagnostic', () => {
		spawnSync.mockReturnValue({
			stdout: '{"WP_Query::get_posts":{"ct":3,"wt":41200,"cpu":38000,"mu":1048576,"pmu":1148576}}\n',
			stderr: '[server-profile] path=/?p=1 resolved=singular object_id=1\n',
			status: 0,
		});
		const result = runServerProfile(SERVER, 'http://localhost:8765/?p=1');
		expect(result.data).toEqual({
			'WP_Query::get_posts': {
				ct: 3,
				wt: 41200,
				cpu: 38000,
				mu: 1048576,
				pmu: 1148576,
			},
		});
		expect(result.diagnostic).toBe(
			'[server-profile] path=/?p=1 resolved=singular object_id=1'
		);
		expect(result.error).toBeNull();
	});

	test('an empty array means no profiling backend was loaded — not an error', () => {
		spawnSync.mockReturnValue({ stdout: '[]\n', stderr: '', status: 0 });
		const result = runServerProfile(SERVER, 'http://localhost:8765/');
		expect(result.data).toEqual([]);
		expect(result.error).toBeNull();
	});

	test('tolerates a non-JSON preamble line before the JSON payload', () => {
		spawnSync.mockReturnValue({
			stdout: 'Warning: something noisy\n{"fn":{"ct":1,"wt":1,"cpu":1,"mu":1,"pmu":1}}',
			stderr: '',
			status: 0,
		});
		const result = runServerProfile(SERVER, 'http://localhost:8765/');
		expect(result.data.fn.ct).toBe(1);
	});

	test('degrades (never throws) on a spawn-level failure', () => {
		spawnSync.mockReturnValue({
			error: new Error('spawn npx ENOENT'),
			stdout: null,
			stderr: null,
		});
		const result = runServerProfile(SERVER, 'http://localhost:8765/');
		expect(result.data).toBeNull();
		expect(result.error).toMatch(/ENOENT/);
	});

	test('degrades (never throws) on unparseable output', () => {
		spawnSync.mockReturnValue({
			stdout: 'PHP Fatal error: something exploded',
			stderr: '',
			status: 255,
		});
		const result = runServerProfile(SERVER, 'http://localhost:8765/');
		expect(result.data).toBeNull();
		expect(result.error).toMatch(/no parseable output/);
	});

	test('degrades (never throws) on a malformed URL — e.g. a scheme-less base_url typo', () => {
		const result = runServerProfile(SERVER, 'not-a-valid-url');
		expect(result.data).toBeNull();
		expect(result.diagnostic).toBeNull();
		expect(result.error).toBeTruthy();
		expect(spawnSync).not.toHaveBeenCalled();
	});
});

/**
 * Tests for src/init/manage.js -- the unknown-argument branch that must tell
 * a purely scaffold-only flag set apart from a genuinely invalid one.
 */

'use strict';

const { manageFlow } = require('../../src/init/manage');

afterEach(() => {
	// manageFlow sets process.exitCode as a side effect on these paths.
	process.exitCode = 0;
});

const makeUi = () => {
	const calls = { error: [], info: [] };
	return {
		ui: {
			error: (msg) => calls.error.push(msg),
			info: (msg) => calls.info.push(msg),
		},
		calls,
	};
};

describe('manageFlow unknown-argument handling', () => {
	it('explains setup-mode when every unknown arg is scaffold-only', async () => {
		const { ui, calls } = makeUi();
		await manageFlow({}, '/root', ['--name=X'], {}, ui, async () => {});
		expect(calls.error).toHaveLength(0);
		expect(calls.info).toHaveLength(1);
		expect(calls.info[0]).toMatch(/apply only during first-time setup/);
	});

	it('reports the generic error when a scaffold-only flag is mixed with a genuinely unknown one', async () => {
		const { ui, calls } = makeUi();
		await manageFlow(
			{},
			'/root',
			['--name=X', '--bogus'],
			{},
			ui,
			async () => {}
		);
		expect(calls.info).toHaveLength(0);
		expect(calls.error).toEqual(['Unknown argument(s): --name=X --bogus']);
	});
});

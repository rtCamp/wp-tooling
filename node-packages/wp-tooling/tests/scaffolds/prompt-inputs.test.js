/**
 * Tests for src/scaffolds/prompt-inputs.js (interactive layer).
 *
 * Locks in that promptMissingInputs / confirmRun pass `defaultValue:` to
 * the TTY UI prompts. A regression that sent `default:` instead would
 * silently drop the default value (pressing Enter would return empty
 * string for text(), and rejected the run for confirm()).
 */

'use strict';

jest.mock('../../src/ui', () => {
	const calls = { text: [], confirm: [] };
	return {
		__esModule: false,
		__calls: calls,
		text: jest.fn(async (opts) => {
			calls.text.push(opts);
			return opts.defaultValue !== undefined ? opts.defaultValue : '';
		}),
		confirm: jest.fn(async (opts) => {
			calls.confirm.push(opts);
			return opts.defaultValue !== undefined ? opts.defaultValue : false;
		}),
		CancelledError: class CancelledError extends Error {},
	};
});

const ui = require('../../src/ui');
const {
	promptMissingInputs,
	confirmRun,
} = require('../../src/scaffolds/prompt-inputs');

beforeEach(() => {
	ui.__calls.text.length = 0;
	ui.__calls.confirm.length = 0;
	ui.text.mockClear();
	ui.confirm.mockClear();
});

describe('promptMissingInputs', () => {
	it('passes `defaultValue` (not `default`) to text()', async () => {
		const scaffold = {
			inputs: [
				{
					key: 'namespace',
					description: 'PHP namespace',
					default: 'Inc\\Cli',
				},
			],
		};
		const result = await promptMissingInputs({
			scaffold,
			missing: ['namespace'],
			missingDetails: [
				{ key: 'namespace', description: 'PHP namespace' },
			],
			supplied: {},
		});

		expect(ui.text).toHaveBeenCalledTimes(1);
		const opts = ui.__calls.text[0];
		expect(opts).toHaveProperty('defaultValue', 'Inc\\Cli');
		expect(opts).not.toHaveProperty('default');
		// Mock returns defaultValue when Enter is "pressed".
		expect(result.namespace).toBe('Inc\\Cli');
	});

	it('omits defaultValue when scaffold input has no default', async () => {
		const scaffold = {
			inputs: [
				{ key: 'name', description: 'Command slug', required: true },
			],
		};
		await promptMissingInputs({
			scaffold,
			missing: ['name'],
			missingDetails: [{ key: 'name', description: 'Command slug' }],
			supplied: {},
		});
		expect(ui.__calls.text[0].defaultValue).toBeUndefined();
	});
});

describe('confirmRun', () => {
	it('passes `defaultValue: true` (not `default: true`) to confirm()', async () => {
		await confirmRun({
			scaffoldId: 'wp/cli',
			willCreate: ['includes/Cli/QmExport.php'],
		});
		expect(ui.confirm).toHaveBeenCalledTimes(1);
		const opts = ui.__calls.confirm[0];
		expect(opts).toHaveProperty('defaultValue', true);
		expect(opts).not.toHaveProperty('default');
	});
});

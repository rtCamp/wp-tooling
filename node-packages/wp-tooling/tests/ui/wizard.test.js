/**
 * Tests for the Wizard class.
 */
'use strict';

const { Wizard } = require('../../src/ui/wizard/index');

// Silence terminal output during tests.
beforeEach(() => {
	jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
	jest.restoreAllMocks();
});

describe('Wizard', () => {
	it('should run all steps in order', async () => {
		const order = [];
		const steps = [
			{
				name: 'Step A',
				run: async (ctx) => {
					order.push('A');
					ctx.a = true;
				},
			},
			{
				name: 'Step B',
				run: async (ctx) => {
					order.push('B');
					ctx.b = true;
				},
			},
			{
				name: 'Step C',
				run: async (ctx) => {
					order.push('C');
					ctx.c = true;
				},
			},
		];

		const ctx = {};
		const wizard = new Wizard(steps, ctx);
		const result = await wizard.run();

		expect(order).toEqual(['A', 'B', 'C']);
		expect(result).toEqual({ a: true, b: true, c: true });
		expect(result).toBe(ctx);
	});

	it('should honour the skip() predicate', async () => {
		const order = [];
		const steps = [
			{
				name: 'Step A',
				run: async () => {
					order.push('A');
				},
			},
			{
				name: 'Step B',
				skip: () => true,
				run: async () => {
					order.push('B');
				},
			},
			{
				name: 'Step C',
				run: async () => {
					order.push('C');
				},
			},
		];

		const wizard = new Wizard(steps);
		await wizard.run();

		expect(order).toEqual(['A', 'C']);
	});

	it('should pass context to skip()', async () => {
		const steps = [
			{
				name: 'Step A',
				run: async (ctx) => {
					ctx.skipB = true;
				},
			},
			{ name: 'Step B', skip: (ctx) => ctx.skipB, run: async () => {} },
		];

		const ctx = {};
		const wizard = new Wizard(steps, ctx);
		await wizard.run();

		expect(ctx.skipB).toBe(true);
	});

	it('should default context to empty object', async () => {
		const steps = [
			{
				name: 'Step A',
				run: async (ctx) => {
					ctx.done = true;
				},
			},
		];

		const wizard = new Wizard(steps);
		const result = await wizard.run();

		expect(result.done).toBe(true);
	});

	it('should default steps to empty array', async () => {
		const wizard = new Wizard();
		const result = await wizard.run();

		expect(result).toEqual({});
	});

	it('should handle an empty steps array', async () => {
		const wizard = new Wizard([]);
		const result = await wizard.run();

		expect(result).toEqual({});
	});

	it('should throw a clear error when steps is not an array', () => {
		expect(() => new Wizard(null)).toThrow(
			'Wizard expected "steps" to be an array, received null.'
		);
		expect(() => new Wizard({})).toThrow(
			'Wizard expected "steps" to be an array, received object.'
		);
	});

	it('should omit ANSI formatting in non-TTY mode', async () => {
		const stdoutTTYDescriptor = Object.getOwnPropertyDescriptor(
			process.stdout,
			'isTTY'
		);
		Object.defineProperty(process.stdout, 'isTTY', {
			value: false,
			configurable: true,
		});
		try {
			const wizard = new Wizard([
				{
					name: 'Step A',
					run: async () => {},
				},
			]);

			await wizard.run();

			const output = process.stdout.write.mock.calls
				.map(([text]) => String(text))
				.join('');

			expect(output).toContain('> [1/1] Step A');
			expect(output).not.toMatch(/\x1b\[/);
		} finally {
			if (stdoutTTYDescriptor) {
				Object.defineProperty(
					process.stdout,
					'isTTY',
					stdoutTTYDescriptor
				);
			} else {
				delete process.stdout.isTTY;
			}
		}
	});

	it('should propagate step errors', async () => {
		const steps = [
			{
				name: 'Failing step',
				run: async () => {
					throw new Error('boom');
				},
			},
		];

		const wizard = new Wizard(steps);
		await expect(wizard.run()).rejects.toThrow('boom');
	});
});

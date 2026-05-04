/**
 * Tests for the Wizard class.
 */
'use strict';

const { Wizard } = require('../../src/ui/wizard/index');

// Silence terminal output during tests.
beforeEach(() => {
	jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
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

	it('should handle an empty steps array', async () => {
		const wizard = new Wizard([]);
		const result = await wizard.run();

		expect(result).toEqual({});
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

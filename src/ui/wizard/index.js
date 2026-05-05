/**
 * Wizard -- runs steps in order, sharing a context object.
 *
 * Zero external dependencies.
 */
'use strict';

const { writeLine, ANSI, isTTY } = require('../core/terminal');

/**
 * Wizard class -- orchestrates an array of steps in order.
 *
 * Each step must have:
 * - `name`  {string}         -- human-readable label
 * - `run`   {Function(ctx)}  -- async function performing the step's work
 * - `skip`  {Function(ctx)}  -- optional; return truthy to skip the step
 */
class Wizard {
	/**
	 * Create a Wizard instance.
	 *
	 * @param {Array<{name: string, run: Function, skip?: Function}>} steps   - Ordered steps.
	 * @param {Object}                                                context - Shared mutable context.
	 */
	constructor(steps = [], context = {}) {
		if (!Array.isArray(steps)) {
			const received = steps === null ? 'null' : typeof steps;
			throw new TypeError(
				`Wizard expected "steps" to be an array, received ${received}.`
			);
		}

		this.steps = steps;
		this.context = context;
	}

	/**
	 * Run all steps in order.
	 *
	 * Calls `skip(ctx)` before each step. If it returns truthy, the step is
	 * skipped. Otherwise, `run(ctx)` is awaited.
	 *
	 * @return {Promise<Object>} The shared context after all steps have run.
	 */
	async run() {
		const tty = isTTY();

		for (let i = 0; i < this.steps.length; i++) {
			const step = this.steps[i];
			const label = `[${i + 1}/${this.steps.length}] ${step.name}`;

			if (typeof step.skip === 'function' && step.skip(this.context)) {
				writeLine(
					tty
						? `${ANSI.dim}>> ${label} (skipped)${ANSI.reset}`
						: `>> ${label} (skipped)`
				);
				continue;
			}

			writeLine(
				tty
					? `\n${ANSI.cyan}>${ANSI.reset} ${ANSI.bold}${label}${ANSI.reset}`
					: `\n> ${label}`
			);
			await step.run(this.context);
		}
		return this.context;
	}
}

module.exports = { Wizard };

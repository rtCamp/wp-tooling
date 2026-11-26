/**
 * CLI plumbing shared by the CI commands (`coverage-gate`, `iapi-check`):
 * table-driven flag parsing, and GitHub Actions output (workflow commands,
 * `$GITHUB_OUTPUT` and `$GITHUB_STEP_SUMMARY` appends) with the `--dry-run`
 * preview of each.
 */

'use strict';

const fs = require('fs');

const { takeValue, formatGithubLine } = require('./detect-changes');

/**
 * Parse argv (after the subcommand name) against flag tables. An empty value
 * counts as not given, so a workflow can pass `--flag "${{ inputs.x }}"`
 * whether or not the input is set.
 *
 * @param {string[]}               argv
 * @param {Object<string, string>} valueFlags   Flag → option key, for flags that take a value.
 * @param {Object<string, string>} booleanFlags Flag → option key, for flags that don't.
 * @return {Object} Option key → raw string, or `true` for boolean flags.
 */
function parseFlags(argv, valueFlags, booleanFlags) {
	const opts = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (Object.hasOwn(booleanFlags, arg)) {
			opts[booleanFlags[arg]] = true;
			continue;
		}
		if (!Object.hasOwn(valueFlags, arg)) {
			throw new Error(`unknown argument: ${arg}`);
		}
		const value = takeValue(argv, ++i, arg);
		if (value !== '') {
			opts[valueFlags[arg]] = value;
		}
	}
	return opts;
}

/**
 * Check a raw value against the allowed choices, or fall back to a default.
 *
 * @param {string|undefined} raw
 * @param {string[]}         choices
 * @param {string}           fallback
 * @param {string}           flag     Flag name, for the error message.
 * @return {string} The chosen value.
 */
function parseChoice(raw, choices, fallback, flag) {
	if (raw === undefined) {
		return fallback;
	}
	if (!choices.includes(raw)) {
		throw new Error(
			`invalid ${flag} "${raw}" (expected one of: ${choices.join(', ')})`
		);
	}
	return raw;
}

/**
 * Print workflow commands, or, under --dry-run, print them prefixed so the
 * runner does not act on them.
 *
 * @param {string[]} commands Workflow command lines.
 * @param {boolean}  dryRun
 */
function emitAnnotations(commands, dryRun) {
	if (commands.length === 0) {
		return;
	}
	const lines = dryRun
		? commands.map((command) => `[dry-run] would emit: ${command}`)
		: commands;
	process.stdout.write(lines.join('\n') + '\n');
}

/**
 * Append to the file a GitHub Actions environment variable points at.
 *
 * @param {Object} env      Environment to read the path from.
 * @param {string} variable e.g. `GITHUB_OUTPUT`.
 * @param {string} content
 * @param {string} command  Command name, for the warning when the variable is unset.
 */
function appendToEnvFile(env, variable, content, command) {
	const dest = env[variable];
	if (!dest) {
		process.stderr.write(
			`${command}: --output github requested but $${variable} is unset; nothing written.\n`
		);
		return;
	}
	fs.appendFileSync(dest, content);
}

/**
 * Write step outputs and the job summary, or preview them under --dry-run.
 *
 * @param {Object}  outputs         Step output name → value.
 * @param {string}  summary         Markdown summary.
 * @param {Object}  options
 * @param {Object}  options.env     Environment holding `$GITHUB_OUTPUT` and `$GITHUB_STEP_SUMMARY`.
 * @param {boolean} options.dryRun  Preview to stdout instead of writing.
 * @param {string}  options.command Command name, for warnings.
 */
function writeGithubFiles(outputs, summary, { env, dryRun, command }) {
	const outputLines =
		Object.entries(outputs)
			.map(([key, value]) => formatGithubLine(key, value))
			.join('\n') + '\n';
	if (dryRun) {
		process.stdout.write(
			`[dry-run] would append to $GITHUB_OUTPUT:\n${outputLines}` +
				`[dry-run] would append to $GITHUB_STEP_SUMMARY:\n${summary}`
		);
		return;
	}
	appendToEnvFile(env, 'GITHUB_OUTPUT', outputLines, command);
	appendToEnvFile(env, 'GITHUB_STEP_SUMMARY', summary, command);
}

module.exports = {
	parseFlags,
	parseChoice,
	emitAnnotations,
	writeGithubFiles,
};

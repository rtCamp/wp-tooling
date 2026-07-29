/* eslint no-console: 0 */

/**
 * Opt-in diagnostic logger for the init and scaffold flows.
 *
 * INERT unless the environment variable `WP_TOOLING_DEBUG` is truthy (anything
 * other than unset / "0" / "false" / "off"). When it is off every function here
 * is a cheap no-op, so there is zero runtime cost and zero extra output in a
 * normal run.
 *
 * When on, it records, per phase:
 *   - wall time (a bottleneck signal),
 *   - the volume of stdout / stderr the phase produced (a direct proxy for the
 *     tokens an AI agent ingests when it reads command output), and
 *   - any errors (the reliability signal; errors are what send an agent digging
 *     through node_modules).
 *
 * It then APPENDS one self-contained, self-describing block per run to a log
 * file (default `<cwd>/.wp-tooling-debug.log`, override with
 * `WP_TOOLING_DEBUG_LOG`). Nothing is ever written to stdout, so the log never
 * pollutes the very output it measures.
 *
 * The report is written FOR an AI reader: alongside a machine-parseable phase
 * table it emits an "observations" section that pre-flags the slowest phase,
 * the noisiest phase, and every error, so the reader gets ready-made leads for
 * cutting time, tokens, and failures without recomputing them.
 *
 * Usage (all no-ops when disabled):
 *   const debug = require('../debug');
 *   debug.start('npm run init -- ...', { kind: 'plugin', mode: 'scaffold', cwd: root });
 *   await debug.phase('setupFlow', async () => { ... });
 *   debug.event('capabilities', { selected: 4 });
 *   debug.finish({ result: 'ok' });
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Whether a value read from the environment should be treated as "on".
 *
 * @param {string|undefined} value - Raw env value.
 * @return {boolean} True when enabled.
 */
const truthy = (value) =>
	!!value && '0' !== value && 'false' !== value && 'off' !== value;

const ENABLED = truthy(process.env.WP_TOOLING_DEBUG);

// All mutable run state. Untouched while disabled.
const state = {
	active: false,
	logPath: null,
	startNs: 0n,
	command: '',
	context: {},
	phaseStack: [], // Names of currently-open phases (innermost last).
	phases: new Map(), // name -> { calls, ms, stdoutBytes, stdoutLines, stderrBytes }
	events: [], // { atMs, phase, label, detail }
	errors: [], // { phase, message }
	totals: { stdoutBytes: 0, stdoutLines: 0, stderrBytes: 0 },
	orig: { stdout: null, stderr: null },
	exitHooked: false,
};

/**
 * Whether diagnostics are enabled for this process.
 *
 * @return {boolean} True when WP_TOOLING_DEBUG is truthy.
 */
const enabled = () => ENABLED;

/**
 * Current high-resolution time in nanoseconds.
 *
 * @return {bigint} Nanoseconds.
 */
const nowNs = () => process.hrtime.bigint();

/**
 * Milliseconds elapsed since the run started, rounded.
 *
 * @return {number} Elapsed ms.
 */
const sinceStartMs = () => Math.round(Number(nowNs() - state.startNs) / 1e6);

/**
 * The phase currently receiving output (innermost open phase), or "(root)".
 *
 * @return {string} Phase name.
 */
const currentPhase = () =>
	state.phaseStack.length
		? state.phaseStack[state.phaseStack.length - 1]
		: '(root)';

/**
 * Lazily create the per-phase accumulator.
 *
 * @param {string} name - Phase name.
 * @return {Object} The accumulator.
 */
const phaseRow = (name) => {
	let row = state.phases.get(name);
	if (!row) {
		row = {
			calls: 0,
			ms: 0,
			stdoutBytes: 0,
			stdoutLines: 0,
			stderrBytes: 0,
		};
		state.phases.set(name, row);
	}
	return row;
};

/**
 * Count bytes + newlines of a stream chunk and attribute them to the current
 * phase and the run totals. Never throws (real output must never break).
 *
 * @param {'stdout'|'stderr'} stream - Which stream.
 * @param {*}                 chunk  - The chunk passed to write().
 * @param {*}                 enc    - The encoding argument (may be a callback).
 * @return {void}
 */
const recordOutput = (stream, chunk, enc) => {
	try {
		let bytes;
		let text;
		if (Buffer.isBuffer(chunk)) {
			bytes = chunk.length;
			text = chunk.toString('utf8');
		} else {
			text = String(chunk);
			bytes = Buffer.byteLength(
				text,
				'string' === typeof enc ? enc : 'utf8'
			);
		}
		const lines = text ? text.split('\n').length - 1 : 0;
		if ('stdout' === stream) {
			state.totals.stdoutBytes += bytes;
			state.totals.stdoutLines += lines;
			const row = phaseRow(currentPhase());
			row.stdoutBytes += bytes;
			row.stdoutLines += lines;
		} else {
			state.totals.stderrBytes += bytes;
			phaseRow(currentPhase()).stderrBytes += bytes;
		}
	} catch {
		// Diagnostics must never interfere with real output.
	}
};

/**
 * Wrap process.stdout/stderr `write` so output volume is measured, then passed
 * straight through unchanged.
 *
 * @return {void}
 */
const patchStreams = () => {
	['stdout', 'stderr'].forEach((name) => {
		const stream = process[name];
		const orig = stream.write.bind(stream);
		state.orig[name] = orig;
		stream.write = (chunk, enc, cb) => {
			recordOutput(name, chunk, enc);
			return orig(chunk, enc, cb);
		};
	});
};

/**
 * Restore the original stream writers.
 *
 * @return {void}
 */
const unpatchStreams = () => {
	['stdout', 'stderr'].forEach((name) => {
		if (state.orig[name]) {
			process[name].write = state.orig[name];
			state.orig[name] = null;
		}
	});
};

/**
 * Begin a diagnostic run. No-op when disabled.
 *
 * @param {string} command   - The command being run (for the report header).
 * @param {Object} [context] - Free-form context: { kind, mode, cwd, ... }.
 * @return {void}
 */
const start = (command, context = {}) => {
	if (!ENABLED || state.active) {
		return;
	}
	state.active = true;
	state.command = command || '';
	state.context = context || {};
	state.phaseStack = [];
	state.phases = new Map();
	state.events = [];
	state.errors = [];
	state.totals = { stdoutBytes: 0, stdoutLines: 0, stderrBytes: 0 };
	const base = context.cwd || process.cwd();
	state.logPath =
		process.env.WP_TOOLING_DEBUG_LOG ||
		path.join(base, '.wp-tooling-debug.log');
	state.startNs = nowNs();
	patchStreams();
	// Flush even if the process exits before finish() is called.
	if (!state.exitHooked) {
		state.exitHooked = true;
		process.on('exit', () => {
			if (state.active) {
				finish({ result: 'incomplete (process exit)' });
			}
		});
	}
	event('run', { event: 'start', command: state.command });
};

/**
 * Record a timeline event. No-op when inactive.
 *
 * @param {string} label    - Short label.
 * @param {Object} [detail] - Optional structured detail.
 * @return {void}
 */
const event = (label, detail) => {
	if (!state.active) {
		return;
	}
	state.events.push({
		atMs: sinceStartMs(),
		phase: currentPhase(),
		label,
		detail: detail || null,
	});
};

/**
 * Record an error against the current (or named) phase. No-op when inactive.
 *
 * @param {Error|string} err     - The error.
 * @param {string}       [phase] - Optional phase override.
 * @return {void}
 */
const recordError = (err, phase) => {
	if (!state.active) {
		return;
	}
	const message = err && err.message ? err.message : String(err);
	state.errors.push({ phase: phase || currentPhase(), message });
	event('error', { phase: phase || currentPhase(), message });
};

/**
 * Time a phase. Runs `fn`, recording its wall time and output volume against
 * `name`. When disabled it simply awaits `fn`. Errors are recorded then
 * rethrown so control flow is unchanged.
 *
 * @param {string}   name - Phase name.
 * @param {Function} fn   - Async (or sync) function to run.
 * @return {Promise<*>} Whatever `fn` returns.
 */
const phase = async (name, fn) => {
	if (!state.active) {
		return fn();
	}
	state.phaseStack.push(name);
	const row = phaseRow(name);
	row.calls += 1;
	// Captured before fn() runs (required for elapsed timing) and consumed in the
	// finally below, which executes on every path including the try's return.
	// eslint-disable-next-line @wordpress/no-unused-vars-before-return
	const startedNs = nowNs();
	event('phase', { event: 'start', name });
	try {
		return await fn();
	} catch (err) {
		recordError(err, name);
		throw err;
	} finally {
		row.ms += Math.round(Number(nowNs() - startedNs) / 1e6);
		event('phase', { event: 'end', name });
		state.phaseStack.pop();
	}
};

/**
 * Note a step the flow chose to skip (shows up in the timeline).
 *
 * @param {string} name - Step name.
 * @return {void}
 */
const skipped = (name) => {
	if (!state.active) {
		return;
	}
	event('skip', { name });
};

/**
 * Right-pad a string to a column width.
 *
 * @param {string} value - Value.
 * @param {number} width - Column width.
 * @return {string} Padded value.
 */
const pad = (value, width) => String(value).padEnd(width);

/**
 * Percentage of a total, as an integer string with a "%" suffix.
 *
 * @param {number} part  - Part.
 * @param {number} total - Total.
 * @return {string} e.g. "79%".
 */
const pct = (part, total) =>
	total > 0 ? `${Math.round((part / total) * 100)}%` : '0%';

/**
 * Build the auto-flagged "observations" lines for an AI reader.
 *
 * @param {Array}  rows   - Phase rows sorted slowest-first.
 * @param {number} wallMs - Total wall time.
 * @return {string[]} Observation lines.
 */
const observations = (rows, wallMs) => {
	const out = [];
	const slowest = rows[0];
	if (slowest && wallMs > 0 && slowest.ms / wallMs >= 0.4) {
		out.push(
			`BOTTLENECK: phase "${slowest.name}" took ${slowest.ms}ms (${pct(
				slowest.ms,
				wallMs
			)} of wall time).`
		);
	}
	const noisiest = rows
		.slice()
		.sort((a, b) => b.stdoutBytes - a.stdoutBytes)[0];
	if (
		noisiest &&
		state.totals.stdoutBytes > 400 &&
		noisiest.stdoutBytes / state.totals.stdoutBytes >= 0.3
	) {
		out.push(
			`NOISY: phase "${noisiest.name}" wrote ${
				noisiest.stdoutBytes
			} bytes / ${noisiest.stdoutLines} lines to stdout (${pct(
				noisiest.stdoutBytes,
				state.totals.stdoutBytes
			)} of total). An AI reads all of it; consider summarising this phase.`
		);
	}
	if (state.errors.length) {
		state.errors.forEach((e) =>
			out.push(`ERROR in "${e.phase}": ${e.message}`)
		);
	} else {
		out.push('OK: no errors recorded.');
	}
	return out;
};

/**
 * Compose the report block for the run.
 *
 * @param {Object} extra - Extra fields, e.g. { result }.
 * @return {string} The report text.
 */
const buildReport = (extra = {}) => {
	const wallMs = sinceStartMs();
	const rows = Array.from(state.phases.entries())
		.map(([name, r]) => ({ name, ...r }))
		.sort((a, b) => b.ms - a.ms);

	const ctx = Object.entries(state.context)
		.map(([k, v]) => `${k}=${v}`)
		.join(' ');

	const lines = [];
	const rule = '='.repeat(80);
	lines.push(rule);
	lines.push('wp-tooling debug run');
	lines.push(`run: ${new Date().toISOString()}  pid ${process.pid}`);
	lines.push(`command: ${state.command}`);
	if (ctx) {
		lines.push(`context: ${ctx}`);
	}
	lines.push(`result: ${extra.result || 'ok'}`);
	lines.push(`wall_ms: ${wallMs}`);
	lines.push(
		`stdout: ${state.totals.stdoutBytes} bytes / ${state.totals.stdoutLines} lines   ` +
			`stderr: ${state.totals.stderrBytes} bytes   errors: ${state.errors.length}`
	);
	lines.push('');

	lines.push(
		'phases (slowest first) [name | calls | wall_ms | %wall | stdout_bytes | stdout_lines]'
	);
	if (rows.length) {
		rows.forEach((r) => {
			lines.push(
				`  ${pad(r.name, 22)} | ${pad(r.calls, 3)} | ${pad(
					r.ms,
					7
				)} | ${pad(pct(r.ms, wallMs), 5)} | ${pad(
					r.stdoutBytes,
					7
				)} | ${r.stdoutLines}`
			);
		});
	} else {
		lines.push('  (no phases recorded)');
	}
	lines.push('');

	lines.push('observations:');
	observations(rows, wallMs).forEach((o) => lines.push(`  - ${o}`));
	lines.push('');

	lines.push('timeline (ms | phase | label | detail):');
	state.events.forEach((e) => {
		const detail = e.detail ? ` ${JSON.stringify(e.detail)}` : '';
		lines.push(
			`  ${pad(e.atMs, 6)} | ${pad(e.phase, 22)} | ${pad(
				e.label,
				8
			)} |${detail}`
		);
	});
	lines.push(rule);
	lines.push('');
	return lines.join('\n');
};

/**
 * Finish the run: restore streams and append the report. No-op when inactive.
 * Safe to call more than once (subsequent calls are ignored).
 *
 * @param {Object} [extra] - Extra fields, e.g. { result }.
 * @return {void}
 */
const finish = (extra = {}) => {
	if (!state.active) {
		return;
	}
	event('run', { event: 'end', result: extra.result || 'ok' });
	unpatchStreams();
	state.active = false;
	try {
		const report = buildReport(extra);
		fs.appendFileSync(state.logPath, report, 'utf8');
	} catch {
		// Never let diagnostics break the command.
	}
};

module.exports = {
	enabled,
	start,
	phase,
	event,
	recordError,
	skipped,
	finish,
};

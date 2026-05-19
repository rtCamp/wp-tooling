/**
 * `wp-tooling add <category>/<slug>` subcommand.
 *
 * Two modes:
 *   - Interactive (default): wraps registry.execute() in a TTY UI Wizard
 *     (discover -> resolveInputs -> confirm -> execute), prompts for any
 *     missing inputs, asks for confirmation, prints a human-readable report.
 *   - Non-interactive (`--non-interactive` or `--json`): calls
 *     registry.execute() directly. Emits one JSON line on stdout in `--json`
 *     mode. Errors land on stderr with structured JSON.
 *
 * Implements:
 *   WTL-06  the CLI surface for the scaffold engine
 */

'use strict';

const path = require('path');
const { ScaffoldRegistry, ScaffoldError } = require('../../src/scaffolds/registry');

const description = 'Add a scaffold to the current project (e.g., wp-tooling add wp/cli --name=qm-export).';

function parseArgs(argv) {
	const opts = {
		id: null,
		inputs: {},
		nonInteractive: false,
		dryRun: false,
		json: false,
		cwd: process.cwd(),
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--help' || a === '-h') opts.help = true;
		else if (a === '--non-interactive') opts.nonInteractive = true;
		else if (a === '--dry-run') opts.dryRun = true;
		else if (a === '--json') { opts.json = true; opts.nonInteractive = true; }
		else if (a === '--cwd') { opts.cwd = argv[++i]; }
		else if (a.startsWith('--cwd=')) { opts.cwd = a.slice('--cwd='.length); }
		else if (a.startsWith('--')) {
			const eq = a.indexOf('=');
			if (eq === -1) {
				const k = a.slice(2);
				opts.inputs[snakify(k)] = argv[++i];
			} else {
				const k = a.slice(2, eq);
				opts.inputs[snakify(k)] = a.slice(eq + 1);
			}
		} else if (!opts.id) {
			opts.id = a;
		} else {
			throw new Error(`Unexpected argument: ${a}`);
		}
	}
	return opts;
}

function snakify(key) {
	return key.replace(/-/g, '_');
}

function printHelp() {
	console.log([
		'Usage: wp-tooling add <category>/<slug> [--<input>=<value>]... [flags]',
		'',
		'Flags:',
		'  --non-interactive    Fail on missing inputs instead of prompting.',
		'  --dry-run            Print the plan without writing files.',
		'  --json               Emit a single JSON line on stdout. Implies --non-interactive.',
		'  --cwd <path>         Target directory. Defaults to the current working directory.',
		'  --help, -h           Show this help text.',
		'',
		'Examples:',
		'  wp-tooling add wp/cli --name=qm-export',
		'  wp-tooling add wp/cli --non-interactive --json --name=qm-export --namespace=Inc',
		'  wp-tooling add ci/cd-wporg --plugin-slug=acme-blog --dry-run',
	].join('\n'));
}

function defaultsDir() {
	// wp-tooling's bundled scaffolds, two levels up from this file.
	return path.join(__dirname, '..', '..', 'scaffolds');
}

function projectDir(cwd) {
	return path.join(cwd, 'bin', 'scaffolds');
}

async function buildRegistry(cwd) {
	const registry = new ScaffoldRegistry({
		defaultsDir: defaultsDir(),
		projectDir: projectDir(cwd),
	});
	await registry.scan();
	return registry;
}

function formatErrorPayload(err) {
	if (err instanceof ScaffoldError) {
		const payload = { code: err.code, message: err.message };
		for (const k of ['scaffold', 'requested', 'available', 'missing', 'missingDetails', 'path', 'errno', 'placeholder', 'template']) {
			if (err[k] !== undefined) payload[k] = err[k];
		}
		return payload;
	}
	return { code: 'EUNKNOWN', message: err && err.message ? err.message : String(err) };
}

function printHumanReport(result) {
	const { scaffold, engine, developer, ai, warnings } = result;
	const lines = [];
	lines.push(`Scaffold: ${scaffold.id}${scaffold.dryRun ? ' (dry run)' : ''}, kind: ${scaffold.kind}`);
	lines.push('');
	if (engine.wrote.length) {
		lines.push('Engine wrote:');
		for (const p of engine.wrote) lines.push(`  + ${p}`);
	} else {
		lines.push('Engine wrote: (no files)');
	}
	if (engine.skipped.length) {
		lines.push('Engine skipped (file already existed):');
		for (const p of engine.skipped) lines.push(`  = ${p}`);
	}
	lines.push('');
	const composer = Object.entries(developer.install.composer);
	const npm = Object.entries(developer.install.npm);
	if (composer.length || npm.length || developer.secrets.length) {
		lines.push('Developer actions:');
		if (composer.length) {
			lines.push('  Install (composer):');
			for (const [pkg, ver] of composer) lines.push(`    composer require ${pkg}:${ver}`);
		}
		if (npm.length) {
			lines.push('  Install (npm):');
			for (const [pkg, ver] of npm) lines.push(`    npm install ${pkg}@${ver}`);
		}
		if (developer.secrets.length) {
			lines.push('  Set secrets (run these yourself; I never set secrets):');
			for (const s of developer.secrets) {
				lines.push(`    gh secret set ${s.key}`);
				lines.push(`    # ${s.description}`);
			}
		}
		lines.push('');
	}
	if (ai.wiring.length) {
		lines.push('Wiring suggestions (apply manually or via AI orchestrator):');
		for (const w of ai.wiring) {
			lines.push(`  File: ${w.targetFile}`);
			if (w.description) lines.push(`  Description: ${w.description}`);
			lines.push(`  Insert near anchor: ${w.anchor}`);
			lines.push('  Snippet:');
			for (const line of w.snippet.split('\n')) lines.push(`    ${line}`);
			lines.push('');
		}
	}
	if (ai.tests.length) {
		lines.push('Tests scaffolded:');
		for (const t of ai.tests) {
			lines.push(`  + ${t.path} (${t.framework}${t.command ? `, run: ${t.command}` : ''})`);
		}
		lines.push('');
	}
	if (warnings.length) {
		lines.push('Warnings:');
		for (const w of warnings) lines.push(`  ! ${w}`);
		lines.push('');
	}
	lines.push('Done.');
	console.log(lines.join('\n'));
}

async function runInteractive(opts) {
	// Lazy require so non-interactive callers never load TTY UI.
	const { Wizard, spinner, confirm } = require('@rtcamp/wp-tooling/ui');
	const { promptMissingInputs } = require('../../src/scaffolds/prompt-inputs');

	const context = {
		opts,
		registry: null,
		scaffold: null,
		inputs: { ...opts.inputs },
		result: null,
	};

	const steps = [
		{
			name: 'discover',
			async run(ctx) {
				ctx.registry = await buildRegistry(ctx.opts.cwd);
				ctx.scaffold = ctx.registry.get(ctx.opts.id);
				if (!ctx.scaffold) {
					throw new ScaffoldError(
						'ENOSCAFFOLD',
						`No scaffold registered for slug: ${ctx.opts.id}`,
						{ requested: ctx.opts.id, available: ctx.registry.all().map((e) => e.category ? `${e.category}/${e.slug}` : e.slug) }
					);
				}
			},
		},
		{
			name: 'resolveInputs',
			async run(ctx) {
				// Loop: try execute(dry-run), on EMISSINGINPUT prompt and retry.
				while (true) { // eslint-disable-line no-constant-condition
					try {
						ctx.result = await ctx.registry.execute(ctx.opts.id, ctx.inputs, { dryRun: true, cwd: ctx.opts.cwd });
						return;
					} catch (err) {
						if (err.code !== 'EMISSINGINPUT') throw err;
						ctx.inputs = await promptMissingInputs({
							scaffold: ctx.scaffold,
							missing: err.missing,
							missingDetails: err.missingDetails,
							supplied: ctx.inputs,
						});
					}
				}
			},
		},
		{
			name: 'confirm',
			async run(ctx) {
				const ok = await confirm({
					message: `Scaffold ${ctx.opts.id} will create ${ctx.result.engine.wrote.length} file(s). Proceed?`,
					default: true,
				});
				if (!ok) {
					const { CancelledError } = require('@rtcamp/wp-tooling/ui');
					throw new CancelledError('Cancelled by developer');
				}
			},
			skip(ctx) { return ctx.opts.dryRun; },
		},
		{
			name: 'execute',
			async run(ctx) {
				if (ctx.opts.dryRun) return; // already have the plan from resolveInputs
				const s = spinner(`Scaffolding ${ctx.opts.id}...`);
				s.start();
				try {
					ctx.result = await ctx.registry.execute(ctx.opts.id, ctx.inputs, { dryRun: false, cwd: ctx.opts.cwd });
					s.succeed(`Scaffolded ${ctx.opts.id}`);
				} catch (err) {
					s.fail(`Failed to scaffold ${ctx.opts.id}`);
					throw err;
				}
			},
		},
	];

	const wizard = new Wizard(steps, context);
	await wizard.run();
	printHumanReport(context.result);
	return 0;
}

async function runNonInteractive(opts) {
	const registry = await buildRegistry(opts.cwd);
	const result = await registry.execute(opts.id, opts.inputs, { dryRun: opts.dryRun, cwd: opts.cwd });
	if (opts.json) {
		process.stdout.write(JSON.stringify(result) + '\n');
	} else {
		printHumanReport(result);
	}
	return 0;
}

async function run(argv) {
	const opts = parseArgs(argv);
	if (opts.help) {
		printHelp();
		return 0;
	}
	if (!opts.id) {
		console.error('Error: scaffold id is required (e.g., wp/cli).');
		printHelp();
		return 1;
	}
	try {
		return opts.nonInteractive ? await runNonInteractive(opts) : await runInteractive(opts);
	} catch (err) {
		if (err && err.name === 'CancelledError') throw err; // dispatcher handles
		if (opts.json) {
			process.stderr.write(JSON.stringify(formatErrorPayload(err)) + '\n');
		} else {
			console.error(`Error: ${err && err.message ? err.message : err}`);
			if (err && err.code === 'ENOSCAFFOLD' && Array.isArray(err.available)) {
				console.error('Available scaffolds:');
				for (const s of err.available) console.error(`  ${s}`);
			}
		}
		return 1;
	}
}

module.exports = { run, description };

#!/usr/bin/env node
/**
 * wp-tooling CLI dispatcher.
 *
 * Loads subcommands from `bin/commands/*.js` by filename so adding a new
 * command is a single file drop, no edit here required.
 *
 * Usage:
 *   wp-tooling <command> [args...]
 *   wp-tooling --help
 */

'use strict';

const fs = require('fs');
const path = require('path');

const COMMANDS_DIR = path.join(__dirname, 'commands');

function discoverCommands() {
	const map = {};
	let entries;
	try {
		entries = fs.readdirSync(COMMANDS_DIR, { withFileTypes: true });
	} catch (err) {
		if (err.code === 'ENOENT') return map;
		throw err;
	}
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
		const name = entry.name.replace(/\.js$/, '');
		const mod = require(path.join(COMMANDS_DIR, entry.name));
		if (typeof mod.run !== 'function') {
			throw new Error(`Command '${name}' is missing a run() export.`);
		}
		map[name] = mod;
	}
	return map;
}

function printHelp(commands) {
	const lines = [
		'Usage: wp-tooling <command> [args...]',
		'',
		'Available commands:',
	];
	for (const name of Object.keys(commands).sort()) {
		const desc = commands[name].description || '';
		lines.push(`  ${name.padEnd(20)} ${desc}`);
	}
	lines.push('', 'Run `wp-tooling <command> --help` for command-specific options.');
	console.log(lines.join('\n'));
}

async function main(argv) {
	const commands = discoverCommands();
	const [, , cmdName, ...rest] = argv;

	if (!cmdName || cmdName === '--help' || cmdName === '-h') {
		printHelp(commands);
		process.exit(cmdName ? 0 : 1);
	}

	const cmd = commands[cmdName];
	if (!cmd) {
		console.error(`Unknown command: ${cmdName}`);
		printHelp(commands);
		process.exit(1);
	}

	try {
		const code = await cmd.run(rest);
		process.exit(typeof code === 'number' ? code : 0);
	} catch (err) {
		if (err && err.name === 'CancelledError') {
			console.error('Cancelled.');
			process.exit(130);
		}
		console.error(`Error: ${err && err.message ? err.message : err}`);
		process.exit(1);
	}
}

if (require.main === module) {
	main(process.argv);
}

module.exports = { discoverCommands, main };

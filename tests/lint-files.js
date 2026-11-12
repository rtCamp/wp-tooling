'use strict';

/**
 * Lints virtual files with one of this package's configs and prints the results as JSON.
 *
 * Runs in its own Node process: `@wordpress/eslint-plugin` 27+ requires the ESM-only
 * `eslint-plugin-jsdoc`, which Node loads natively but Jest's module loader can't.
 *
 * Usage: node lint-files.js <config file>, with a JSON map of file path to source on stdin.
 */
const fs = require('node:fs');
const path = require('node:path');
const { ESLint } = require('eslint');

const lintFiles = async (configFile, files) => {
	const eslint = new ESLint({
		cwd: __dirname,
		overrideConfigFile: true,
		overrideConfig: require(path.resolve(configFile)),
	});
	const results = {};
	for (const [filePath, code] of Object.entries(files)) {
		if (await eslint.isPathIgnored(filePath)) {
			results[filePath] = { ignored: true, rules: [], ruleIds: [] };
			continue;
		}
		const config = await eslint.calculateConfigForFile(filePath);
		const [result] = await eslint.lintText(code, { filePath });
		results[filePath] = {
			ignored: false,
			rules: Object.keys(config.rules),
			ruleIds: result.messages.map((message) => message.ruleId),
		};
	}
	return results;
};

lintFiles(process.argv[2], JSON.parse(fs.readFileSync(0, 'utf8'))).then(
	(results) => process.stdout.write(JSON.stringify(results))
);

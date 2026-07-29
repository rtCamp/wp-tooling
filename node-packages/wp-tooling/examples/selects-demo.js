/**
 * Selects demo -- run with: node examples/selects-demo.js
 *
 * Exercises: radio (single-select), checkbox (multi-select), checkboxTree (grouped multi-select).
 */
'use strict';

const { radio, checkbox, checkboxTree } = require('../src/ui/index');

async function main() {
	console.log('=== Selects Demo ===\n');

	// 1. Radio -- single select.
	const framework = await radio({
		message: 'Pick a CSS framework',
		choices: ['None', 'Tailwind', 'Bootstrap', 'Bulma'],
	});
	console.log(`  -> framework: ${framework}\n`);

	// 2. Checkbox -- multi select.
	const features = await checkbox({
		message: 'Which features do you need?',
		choices: [
			'Authentication',
			'REST API',
			'GraphQL',
			'Cron jobs',
			'Email notifications',
		],
	});
	console.log(`  -> features: ${features.join(', ')}\n`);

	// 3. CheckboxTree -- grouped multi select.
	const plugins = await checkboxTree({
		message: 'Select plugins to install',
		groups: [
			{
				label: 'SEO',
				items: ['Yoast SEO', 'Rank Math', 'All in One SEO'],
			},
			{
				label: 'Performance',
				items: ['WP Rocket', 'Autoptimize', 'Redis Object Cache'],
			},
			{
				label: 'Security',
				items: ['Wordfence', 'Sucuri', 'iThemes Security'],
			},
		],
	});
	console.log(`  -> plugins: ${plugins.join(', ')}\n`);

	console.log(
		'Done. Selected:',
		JSON.stringify({ framework, features, plugins }, null, 2)
	);
}

main();

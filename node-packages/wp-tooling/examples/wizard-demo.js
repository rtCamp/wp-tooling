/**
 * Full UI kit demo -- run with: node examples/wizard-demo.js
 *
 * Exercises every primitive: Wizard, text, confirm, password,
 * checkbox, radio, checkboxTree, and spinner.
 */
'use strict';

const {
	Wizard,
	text,
	confirm,
	password,
	checkbox,
	radio,
	checkboxTree,
	spinner,
} = require('../src/ui/index');

const steps = [
	{
		name: 'Project name',
		async run(ctx) {
			ctx.name = await text({
				message: 'What is your project name?',
				validate: (v) => (v ? undefined : 'Name is required'),
			});
		},
	},
	{
		name: 'Registry credentials',
		async run(ctx) {
			ctx.token = await password({ message: 'npm token' });
		},
	},
	{
		name: 'Language',
		async run(ctx) {
			ctx.lang = await radio({
				message: 'Pick a language',
				choices: ['JavaScript', 'TypeScript'],
			});
		},
	},
	{
		name: 'Lint tools',
		async run(ctx) {
			ctx.linters = await checkbox({
				message: 'Select linters',
				choices: ['ESLint', 'Stylelint', 'Prettier'],
			});
		},
	},
	{
		name: 'Modules',
		async run(ctx) {
			ctx.modules = await checkboxTree({
				message: 'Select modules to scaffold',
				groups: [
					{
						label: 'Utilities',
						items: ['cache', 'logger', 'transients'],
					},
					{
						label: 'Integrations',
						items: ['algolia', 'action-scheduler'],
					},
				],
			});
		},
	},
	{
		name: 'Confirm setup',
		async run(ctx) {
			ctx.confirmed = await confirm({
				message: `Create "${ctx.name}" with ${ctx.modules.length} modules?`,
			});
		},
	},
	{
		name: 'Install dependencies',
		skip(ctx) {
			return !ctx.confirmed;
		},
		async run(ctx) {
			const s = spinner(`Installing deps for ${ctx.name}...`);
			s.start();
			s.update('Resolving packages...');
			await new Promise((resolve) => setTimeout(resolve, 500));
			s.update('Linking...');
			await new Promise((resolve) => setTimeout(resolve, 500));
			s.succeed('Dependencies installed');
		},
	},
];

const wizard = new Wizard(steps);
wizard.run().then((ctx) => {
	console.log('\nFinal context:', JSON.stringify(ctx, null, 2));
});

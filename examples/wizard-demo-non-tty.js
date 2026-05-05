/**
 * Non-TTY demo -- proves every primitive works when stdin is not a terminal.
 *
 * Run with:  echo "my-project\nsecret\n2\n1,3\n1,4\ny" | node examples/wizard-demo-non-tty.js
 *
 * Each prompt reads one line from piped stdin. No crashes, no hangs.
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
		name: 'Text prompt',
		async run(ctx) {
			ctx.name = await text({ message: 'Project name' });
			console.log('  -> got:', ctx.name);
		},
	},
	{
		name: 'Password prompt',
		async run(ctx) {
			ctx.token = await password({ message: 'Token' });
			console.log('  -> got:', ctx.token.length, 'chars');
		},
	},
	{
		name: 'Radio select',
		async run(ctx) {
			ctx.lang = await radio({
				message: 'Language',
				choices: ['JavaScript', 'TypeScript'],
			});
			console.log('  -> got:', ctx.lang);
		},
	},
	{
		name: 'Checkbox select',
		async run(ctx) {
			ctx.linters = await checkbox({
				message: 'Linters',
				choices: ['ESLint', 'Stylelint', 'Prettier'],
			});
			console.log('  -> got:', ctx.linters);
		},
	},
	{
		name: 'CheckboxTree select',
		async run(ctx) {
			ctx.modules = await checkboxTree({
				message: 'Modules',
				groups: [
					{
						label: 'Utils',
						items: ['cache', 'logger', 'transients'],
					},
					{ label: 'Integrations', items: ['algolia', 'scheduler'] },
				],
			});
			console.log('  -> got:', ctx.modules);
		},
	},
	{
		name: 'Confirm prompt',
		async run(ctx) {
			ctx.ok = await confirm({ message: 'All good?' });
			console.log('  -> got:', ctx.ok);
		},
	},
	{
		name: 'Spinner',
		async run(ctx) {
			const s = spinner('Working...');
			s.start();
			s.succeed('Done');
			ctx.spinnerOk = true;
		},
	},
];

const wizard = new Wizard(steps);
wizard
	.run()
	.then((ctx) => {
		console.log('\nFinal context:', JSON.stringify(ctx, null, 2));
		process.exit(0);
	})
	.catch((err) => {
		console.error('Wizard failed:', err.message);
		process.exit(1);
	});

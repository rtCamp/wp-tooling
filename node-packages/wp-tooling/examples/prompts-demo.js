/**
 * Prompts demo -- run with: node examples/prompts-demo.js
 *
 * Exercises: text, confirm, password.
 */
'use strict';

const { text, confirm, password } = require('../src/ui/index');

async function main() {
	console.log('=== Prompts Demo ===\n');

	// 1. Basic text input.
	const name = await text({
		message: 'What is your name?',
	});
	console.log(`  -> name: ${name}\n`);

	// 2. Text with default and validation.
	const email = await text({
		message: 'Email address',
		defaultValue: 'user@example.com',
		validate: (v) => (v.includes('@') ? undefined : 'Must contain @'),
	});
	console.log(`  -> email: ${email}\n`);

	// 3. Password (masked input).
	const secret = await password({
		message: 'Enter your API token',
	});
	console.log(`  -> token length: ${secret.length}\n`);

	// 4. Password with custom mask.
	const pin = await password({
		message: 'Enter a PIN',
		mask: '#',
	});
	console.log(`  -> PIN length: ${pin.length}\n`);

	// 5. Confirm with default=false (no).
	const deploy = await confirm({
		message: 'Deploy to production?',
	});
	console.log(`  -> deploy: ${deploy}\n`);

	// 6. Confirm with default=true (yes).
	const lint = await confirm({
		message: 'Run linter before build?',
		defaultValue: true,
	});
	console.log(`  -> lint: ${lint}\n`);

	console.log(
		'Done. Collected:',
		JSON.stringify(
			{ name, email, secret: '***', pin: '***', deploy, lint },
			null,
			2
		)
	);
}

main();

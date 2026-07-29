/**
 * Spinner demo -- run with: node examples/spinner-demo.js
 *
 * Exercises: start, update, succeed, fail.
 */
'use strict';

const { spinner } = require('../src/ui/index');

async function main() {
	console.log('=== Spinner Demo ===\n');

	// 1. Basic spinner with success.
	const s1 = spinner('Fetching remote config...');
	s1.start();
	await new Promise((resolve) => setTimeout(resolve, 1200));
	s1.succeed('Remote config loaded');

	// 2. Spinner with text updates.
	const s2 = spinner('Building project...');
	s2.start();
	await new Promise((resolve) => setTimeout(resolve, 600));
	s2.update('Compiling assets...');
	await new Promise((resolve) => setTimeout(resolve, 600));
	s2.update('Optimising bundles...');
	await new Promise((resolve) => setTimeout(resolve, 600));
	s2.succeed('Build complete');

	// 3. Spinner that fails.
	const s3 = spinner('Running test suite...');
	s3.start();
	await new Promise((resolve) => setTimeout(resolve, 1000));
	s3.fail('3 tests failed');

	// 4. Sequential spinners simulating a deploy pipeline.
	const stages = [
		'Linting source files',
		'Running unit tests',
		'Building Docker image',
		'Pushing to registry',
	];

	for (const stage of stages) {
		const s = spinner(stage + '...');
		s.start();
		await new Promise((resolve) => setTimeout(resolve, 800));
		s.succeed(stage);
	}

	console.log('\nDone.');
}

main();

'use strict';

const { RunnerError, isUsageError } = require('../../src/a11y/errors');

describe('isUsageError', () => {
	test('is true for EBINMISSING and ENOURLS', () => {
		expect(isUsageError(new RunnerError('EBINMISSING', 'x'))).toBe(true);
		expect(isUsageError(new RunnerError('ENOURLS', 'x'))).toBe(true);
	});

	test('is false for EBINFAIL and EBADJSON', () => {
		expect(isUsageError(new RunnerError('EBINFAIL', 'x'))).toBe(false);
		expect(isUsageError(new RunnerError('EBADJSON', 'x'))).toBe(false);
	});

	test('is false for a non-RunnerError', () => {
		expect(isUsageError(new Error('x'))).toBe(false);
		expect(isUsageError(null)).toBe(false);
	});
});

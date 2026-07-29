'use strict';

const config = require('../index');

describe('stylelint config', () => {
	it('exports a plain object', () => {
		expect(typeof config).toBe('object');
		expect(config).not.toBeNull();
		expect(Array.isArray(config)).toBe(false);
	});

	it('extends @wordpress/stylelint-config', () => {
		expect(config.extends).toContain('@wordpress/stylelint-config');
	});

	it('extends @wordpress/stylelint-config/scss', () => {
		expect(config.extends).toContain('@wordpress/stylelint-config/scss');
	});
});

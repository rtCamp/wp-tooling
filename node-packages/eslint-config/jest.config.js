/**
 * Jest configuration — @rtcamp/eslint-config
 * Docs: https://jestjs.io/docs/configuration
 */
module.exports = {
	testEnvironment: 'node',
	moduleNameMapper: {
		'^@wordpress/theme(/.*)?$':
			'<rootDir>/tests/__mocks__/wordpress-theme.js',
	},
};

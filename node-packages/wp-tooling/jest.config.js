/**
 * Jest configuration — @rtcamp/wp-tooling
 * Docs: https://jestjs.io/docs/configuration
 */
module.exports = {
    testEnvironment: 'node',
    testMatch: [ '<rootDir>/tests/**/*.test.js' ],
    coverageDirectory: 'coverage',
    collectCoverageFrom: [
        'src/**/*.js',
        '!src/**/index.js',
    ],
    coverageThreshold: {
        global: {
            branches: 60,
            functions: 70,
            lines: 70,
            statements: 70,
        },
    },
    clearMocks: true,
    restoreMocks: true,
    verbose: true,
};

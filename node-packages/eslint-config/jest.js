'use strict';

const jestPlugin = require('eslint-plugin-jest');
const base = require('./base');

module.exports = base([jestPlugin.configs['flat/recommended']]);

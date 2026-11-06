'use strict';

const wordpress = require('@wordpress/eslint-plugin');
const base = require('./base');

module.exports = base(wordpress.configs['test-unit']);

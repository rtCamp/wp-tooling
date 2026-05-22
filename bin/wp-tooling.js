#!/usr/bin/env node

/**
 * wp-tooling CLI entry point. Thin shim over src/cli/index.js — routing,
 * help, and subcommand handlers live there.
 */

'use strict';

const exitCode = require('../src/cli/index.js').main(process.argv.slice(2));
process.exit(exitCode);

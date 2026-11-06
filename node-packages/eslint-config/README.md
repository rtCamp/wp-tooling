<h1 align="center">@rtcamp/eslint-config</h1>

<p align="center">
  <a href="https://github.com/rtCamp/wp-tooling/blob/main/node-packages/eslint-config/LICENSE"><img src="https://img.shields.io/badge/license-GPL--2.0--or--later-blue.svg" alt="License: GPL-2.0-or-later"></a>
  <a href="https://www.npmjs.com/package/@rtcamp/eslint-config"><img src="https://img.shields.io/npm/v/@rtcamp/eslint-config.svg" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.19-339933.svg" alt="Node 22.19+">
</p>

<p align="center">
  rtCamp's shareable ESLint flat config for WordPress projects.
</p>

---

It extends `@wordpress/eslint-plugin` (recommended) and `@eslint-community/eslint-plugin-eslint-comments`, laid out like the default config `@wordpress/scripts` uses for projects without an `eslint.config.js`. `wp-scripts lint-js` drops that default as soon as a project adds its own config, so this package carries the same structure:

- ignores `build/`, `vendor/` and `node_modules/`;
- lints `.jsx`, `.ts`, `.tsx`, `.mts` and `.cts` files alongside `.js`, `.mjs` and `.cjs` (TypeScript files need `typescript` installed);
- applies the `@wordpress/eslint-plugin` `test-unit` rules (Vitest) to `test/` and `__tests__/` directories and to `*.test.*` and `*.spec.*` files.

Like WordPress's default config, the Vitest rules declare no test globals, so test files import `describe`, `it` and `expect` from `'vitest'`. With Vitest's `globals: true` and no imports, every one of them is reported by `no-undef`.

> Requires ESLint 10 (flat config). This package is a flat-config array, not a legacy `.eslintrc`.

## Install

Requires Node.js 22.19+.

Install the peer dependencies first, then the config:

```bash
npm install --save-dev eslint @wordpress/eslint-plugin @eslint-community/eslint-plugin-eslint-comments
npm install --save-dev @rtcamp/eslint-config
```

`eslint` 10, `@wordpress/eslint-plugin` 27 or 28 and `@eslint-community/eslint-plugin-eslint-comments` are peer dependencies. In a project that already has `@wordpress/scripts`, installing everything in one command fails with `ERESOLVE`: its dependencies can leave ESLint 9 at the top of `node_modules`, and npm checks this package's ESLint 10 peer against that copy before replacing it.

## Usage

Create `eslint.config.js` at your project root:

```js
module.exports = require('@rtcamp/eslint-config');
```

Add project-specific overrides by spreading it:

```js
module.exports = [
	...require('@rtcamp/eslint-config'),
	{ rules: { 'no-console': 'off' } },
];
```

In an ES module config (`eslint.config.mjs`), import it instead:

```js
import rtcamp from '@rtcamp/eslint-config';

export default [...rtcamp, { rules: { 'no-console': 'off' } }];
```

### Jest projects

The default test rules target Vitest, which `wp-scripts test-unit-js` runs since `@wordpress/scripts` 36. Projects that still run Jest (`wp-scripts test-unit-jest`) use the Jest entry instead, which applies `eslint-plugin-jest`'s recommended rules to the same test paths:

```js
module.exports = require('@rtcamp/eslint-config/jest');
```

In an `eslint.config.mjs`, use `import rtcamp from '@rtcamp/eslint-config/jest';` instead.

Install `eslint-plugin-jest` alongside it (an optional peer dependency), and keep `jest` installed: some of its rules read the installed Jest version.

## License

GPL-2.0-or-later. See [LICENSE](./LICENSE).

<p align="center">
  <a href="https://rtcamp.com"><img src="https://n8e0ka87m9.gdcdn.us/kfnbt046p8/GitHub_Banner.webp" alt="rtCamp" width="100%"></a>
</p>

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

It extends
`@wordpress/eslint-plugin` (recommended), `@eslint-community/eslint-plugin-eslint-comments`, and
`eslint-plugin-jest` (scoped to `**/*.test.js`).

> Requires ESLint v9+ (flat config). This package is a flat-config array, not a legacy `.eslintrc`.

## Install

Requires Node.js 22.19+.

```bash
npm install --save-dev @rtcamp/eslint-config eslint @wordpress/eslint-plugin
```

`eslint`, `@wordpress/eslint-plugin`, `@eslint-community/eslint-plugin-eslint-comments` and
`eslint-plugin-jest` are peer dependencies; npm 7+ installs them automatically.

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

## License

GPL-2.0-or-later. See [LICENSE](./LICENSE).

<p align="center">
  <a href="https://rtcamp.com"><img src="https://n8e0ka87m9.gdcdn.us/kfnbt046p8/GitHub_Banner.webp" alt="rtCamp" width="100%"></a>
</p>

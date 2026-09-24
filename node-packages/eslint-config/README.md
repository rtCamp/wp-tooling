# @rtcamp/eslint-config

rtCamp's shareable **ESLint flat config** for WordPress projects. Extends
`@wordpress/eslint-plugin` (recommended), `@eslint-community/eslint-plugin-eslint-comments`, and
`eslint-plugin-jest` (scoped to `**/*.test.js`).

> Requires ESLint v9+ (flat config). This package is a flat-config array, not a legacy `.eslintrc`.

## Install

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

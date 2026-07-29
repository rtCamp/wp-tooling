# @rtcamp/tailwind-config

rtCamp's Tailwind CSS v4 integration for WordPress themes: a shareable PostCSS config plus a
webpack plugin that keeps Tailwind theme tokens in sync with `theme.json`.

## Install

```bash
npm install --save-dev @rtcamp/tailwind-config tailwindcss @tailwindcss/postcss
```

`tailwindcss` and `@tailwindcss/postcss` are peer dependencies.

## Usage

`postcss.config.js`:

```js
module.exports = require('@rtcamp/tailwind-config/postcss');
```

`webpack.config.js` — generate `_tailwind-theme.css` from `theme.json` at build time:

```js
const { GenerateTailwindThemePlugin } = require('@rtcamp/tailwind-config');

module.exports = {
	plugins: [new GenerateTailwindThemePlugin()],
};
```

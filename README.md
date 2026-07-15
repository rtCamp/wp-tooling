# @rtcamp/wp-tooling

Shared build- and dev-time tooling for rtCamp WordPress projects, consumed as an
npm package by the plugin and theme skeletons. It is a **library**: import the
piece you need through a subpath export — there is no CLI on this branch.

**Node 22+.** The UI kit has zero runtime dependencies; the lint/Tailwind configs
declare their toolchains as optional peer dependencies (install only what you use).

## What's inside

**Available now**

- **TTY UI kit** — `@rtcamp/wp-tooling/ui`: `Wizard`, `text` / `confirm` /
  `password` prompts, `checkbox` / `radio` / `checkboxTree` selects, `spinner`,
  and `CancelledError`. Zero runtime dependencies.
- **Shared lint configs** — `@rtcamp/wp-tooling/eslint-config` (flat ESLint config
  built on `@wordpress/eslint-plugin`) and `@rtcamp/wp-tooling/stylelint-config`.
- **Tailwind config** — `@rtcamp/wp-tooling/tailwind-config` (+ `/postcss`): the
  `GenerateTailwindThemePlugin` / `generateThemeBlock` helpers.

**Planned (stubs on `main`)**

The scaffold registry, release scripts, git-hook installer, CI helpers, and
version monitor are exposed as subpaths (`/scaffolds`, `/release`, `/hooks`,
`/ci`, `/version-monitor`) but currently resolve to empty stubs. Their working
implementations live on the `release/v1.0.0` line and land here as they stabilise.

## Install

```bash
npm install @rtcamp/wp-tooling
```

## Usage

```js
// TTY UI kit
const { Wizard, spinner, checkbox } = require( '@rtcamp/wp-tooling/ui' );

// Flat ESLint config (eslint.config.js)
module.exports = require( '@rtcamp/wp-tooling/eslint-config' );

// Tailwind theme plugin
const { GenerateTailwindThemePlugin } = require( '@rtcamp/wp-tooling/tailwind-config' );
```

## Development

```bash
npm run check   # eslint src tests + jest
npm test
```

## License

[GPL-2.0-or-later](LICENSE)

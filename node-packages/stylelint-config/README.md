<h1 align="center">@rtcamp/stylelint-config</h1>

<p align="center">
  <a href="https://github.com/rtCamp/wp-tooling/blob/main/node-packages/stylelint-config/LICENSE"><img src="https://img.shields.io/badge/license-GPL--2.0--or--later-blue.svg" alt="License: GPL-2.0-or-later"></a>
  <a href="https://www.npmjs.com/package/@rtcamp/stylelint-config"><img src="https://img.shields.io/npm/v/@rtcamp/stylelint-config.svg" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.23.4-339933.svg" alt="Node 22.23.4+">
</p>

<p align="center">
  rtCamp's shareable Stylelint config for WordPress projects.
</p>

---

It extends
`@wordpress/stylelint-config` and `@wordpress/stylelint-config/scss`.

## Install

Requires Node.js 22.23.4+ and Stylelint 17. `stylelint`, `@wordpress/stylelint-config` and `stylelint-scss` are peer dependencies. Projects on Stylelint 16 stay on `@rtcamp/stylelint-config` 1.x.

With `@wordpress/scripts` 35 or later, which already depends on all three, install the config on its own:

```bash
npm install --save-dev @rtcamp/stylelint-config
```

Without `@wordpress/scripts`, install the peers too:

```bash
npm install --save-dev @rtcamp/stylelint-config stylelint@^17 @wordpress/stylelint-config@^27 stylelint-scss@^7
```

### Upgrading from 1.x

Run the install command above that fits the project. If npm reports `ERESOLVE`, uninstall 1.x and run the install command again:

```bash
npm uninstall @rtcamp/stylelint-config
```

If `package.json` also lists `stylelint`, `@wordpress/stylelint-config` or `stylelint-scss` at their Stylelint 16 versions, add them to that `npm uninstall` command.

## Usage

`.stylelintrc.json`:

```json
{
	"extends": "@rtcamp/stylelint-config"
}
```

## License

GPL-2.0-or-later. See [LICENSE](./LICENSE).

<p align="center">
  <a href="https://rtcamp.com"><img src="https://n8e0ka87m9.gdcdn.us/kfnbt046p8/GitHub_Banner.webp" alt="rtCamp" width="100%"></a>
</p>

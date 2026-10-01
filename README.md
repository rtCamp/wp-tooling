<h1 align="center">@rtcamp/stylelint-config</h1>

<p align="center">
  <a href="https://github.com/rtCamp/wp-tooling/blob/main/node-packages/stylelint-config/LICENSE"><img src="https://img.shields.io/badge/license-GPL--2.0--or--later-blue.svg" alt="License: GPL-2.0-or-later"></a>
  <a href="https://www.npmjs.com/package/@rtcamp/stylelint-config"><img src="https://img.shields.io/npm/v/@rtcamp/stylelint-config.svg" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.19-339933.svg" alt="Node 22.19+">
</p>

<p align="center">
  rtCamp's shareable Stylelint config for WordPress projects.
</p>

---

It extends
`@wordpress/stylelint-config` and `@wordpress/stylelint-config/scss`.

## Install

Requires Node.js 22.19+.

```bash
npm install --save-dev @rtcamp/stylelint-config stylelint @wordpress/stylelint-config stylelint-scss
```

`stylelint`, `@wordpress/stylelint-config` and `stylelint-scss` are peer dependencies.

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

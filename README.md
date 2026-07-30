# @rtcamp/wp-tooling

Shared tooling for rtCamp WordPress projects. Consumed as an npm package by every rtCamp skeleton — plugin and theme alike.

## What's inside

- TTY UI toolkit — Wizard, prompts, selects, spinner (zero-dependency)
- ScaffoldRegistry — auto-discovers `scaffold.json` files in consuming repos
- Release scripts — version bump, changelog, package zip
- Git hooks — commit-msg, pre-commit installer
- Lint configs — `@rtcamp/eslint-config`, `@rtcamp/stylelint-config`
- CI helpers — `detect-changes` and friends
- Version monitor — detectors, updaters, reporters for WordPress / PHP / Node

## Development

See [`AGENTS.md`](../../AGENTS.md) at the monorepo root for architecture rules, coding
standards, testing commands, and the release/subtree-split workflow. Contribution
guidelines live in [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## Install (consumer side)

```bash
npm install @rtcamp/wp-tooling
```

## License

GPL-2.0-or-later. See [LICENSE](./LICENSE).

<p align="center">
  <a href="https://rtcamp.com"><img src="https://n8e0ka87m9.gdcdn.us/kfnbt046p8/GitHub_Banner.webp" alt="rtCamp" width="100%"></a>
</p>

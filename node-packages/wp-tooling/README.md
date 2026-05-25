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

See [`CLAUDE.md`](./CLAUDE.md) for architecture rules, banned packages, testing, and git workflow.

Per-issue progress lives in [`.claude/issues/`](./.claude/issues/). Claude skills live in [`.claude/commands/`](./.claude/commands/).

## Install (consumer side)

```bash
npm install @rtcamp/wp-tooling
```

## License

GPL-2.0-or-later

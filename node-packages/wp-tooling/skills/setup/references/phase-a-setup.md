# Phase A — Project Setup Scaffolds

## Selection table

| Condition | Scaffold | Skip if |
|---|---|---|
| Always | `setup/editorconfig` | `.editorconfig` exists |
| PHP present, no PSR-4 in `composer.json` | `setup/psr4` | `autoload.psr-4` already set |
| VIP project | `lint/phpcs/vip` | `phpcs.xml.dist` exists |
| Non-VIP project | `lint/phpcs/full` | `phpcs.xml.dist` exists |
| Developer explicitly chose core-only PHPCS | `lint/phpcs/core` | `phpcs.xml.dist` exists |
| PHP present | `lint/phpstan` | `phpstan.neon.dist` exists |
| JS present | `lint/eslint` | `eslint.config.js` exists |
| CSS or SCSS present | `lint/stylelint` | `.stylelintrc.js` exists |
| Developer wants PHP tests | `setup/phpunit` | `phpunit.xml.dist` exists |
| Developer wants JS tests | `setup/jest` | `jest.config.js` exists |
| Developer wants a11y tests | `setup/pa11y` | `.pa11yci.json` exists |

## PHPCS standard reference

| Scaffold ID | When to use | Ruleset |
|---|---|---|
| `lint/phpcs/full` | Most rtCamp projects (recommended default) | `vendor/rtcamp/wp-framework/phpcs.xml.dist`, WordPress-Core + Extra + Docs + VIP-Go |
| `lint/phpcs/vip` | WordPress VIP platform projects | `WordPress-VIP-Minimum` + `WordPress-Docs` |
| `lint/phpcs/core` | Projects explicitly opting out of VIP-Go rules | `WordPress` — Core + Extra + Docs only |

## Test scaffold reference

| Scaffold ID | What it installs | When to apply |
|---|---|---|
| `setup/phpunit` | `phpunit.xml.dist`, `tests/bootstrap.php`, PHPUnit + polyfills + Brain Monkey | PHP plugin or theme with tests |
| `setup/jest` | `jest.config.js`, `@wordpress/jest-preset-default` | JS blocks or scripts with unit tests |
| `setup/pa11y` | `.pa11yci.json`, `pa11y-ci` | Any project needing WCAG2AA accessibility coverage |

## Execution commands

Run each in order with `--non-interactive --json --cwd .`. Process each result before running the next.

```bash
# EditorConfig
npx wp-tooling add setup/editorconfig --non-interactive --json --cwd .

# PSR-4 (use detected or developer-confirmed namespace and base path)
npx wp-tooling add setup/psr4 \
    --non-interactive --json --cwd . \
    --namespace='Acme\Plugin' --base-path='includes'

# Lint configs
npx wp-tooling add lint/phpcs/full --non-interactive --json --cwd .
npx wp-tooling add lint/phpstan    --non-interactive --json --cwd .
npx wp-tooling add lint/eslint     --non-interactive --json --cwd .
npx wp-tooling add lint/stylelint  --non-interactive --json --cwd .

# Test frameworks
npx wp-tooling add setup/phpunit --non-interactive --json --cwd . --source-dir=includes
npx wp-tooling add setup/jest    --non-interactive --json --cwd .
npx wp-tooling add setup/pa11y   --non-interactive --json --cwd . --base-url=http://localhost:8888
```

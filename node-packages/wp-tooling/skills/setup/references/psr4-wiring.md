# Wiring Guide

Use this file when you're applying `setup/psr4` wiring to `composer.json` or feature-scaffold wiring (§4-§5 of the workflow).

## Wiring: composer.json PSR-4

When `setup/psr4` wiring is received:

1. Show the current `"autoload"` block in `composer.json` (or note it is absent).
2. Show the intended entry: namespace `Acme\ImageOptimizer` maps to `includes/`.
3. Ask: `Apply PSR-4 autoload to composer.json? [apply / skip]`
4. If apply: paste the engine's `ai.wiring[0].snippet` verbatim. The engine already emits the PSR-4 key JSON-encoded with its trailing backslash (e.g. `"Acme\\ImageOptimizer\\"`) — **do not escape it again**, or you will double the backslashes and break autoload.
5. Remind: run `composer dump-autoload --optimize` after applying.

If `composer.json` does not exist, offer to create a minimal one:

```
composer.json not found. I can create a minimal one:

  {
    "name": "vendor/image-optimizer",
    "type": "wordpress-plugin",
    "require": { "php": ">=8.3" },
    "autoload": {
      "psr-4": { "Acme\\ImageOptimizer\\": "includes/" }
    }
  }

Create it? [yes / skip PSR-4 / give me the values to use]
```

## Wiring: feature scaffolds

Same as the companion `scaffold` skill's adaptive wiring (`../scaffold/references/adaptive-wiring.md`) — `ai.wiring`. Show diff, get consent, apply.

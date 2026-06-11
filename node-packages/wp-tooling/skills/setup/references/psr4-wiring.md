# PSR-4 Wiring Guide

## Applying setup/psr4 wiring

1. Show the current `"autoload"` block in `composer.json` (or note it is absent).
2. Show the intended entry: namespace → path.
3. Ask: `Apply PSR-4 autoload to composer.json? [apply / skip]`
4. If apply: paste the engine's `ai.wiring[0].snippet` verbatim. The engine already emits the PSR-4 key JSON-encoded with its trailing backslash (e.g. `"Acme\\Plugin\\"`) — **do not escape it again**, or you will double the backslashes and break autoload.
5. Remind: run `composer dump-autoload --optimize` after applying.

If `composer.json` does not exist, offer to create a minimal one:

```
composer.json not found. I can create a minimal one:

  {
    "name": "vendor/plugin-name",
    "type": "wordpress-plugin",
    "require": { "php": ">=8.3" },
    "autoload": {
      "psr-4": { "Acme\\Plugin\\": "includes/" }
    }
  }

Create it? [yes / skip PSR-4 / give me the values to use]
```

## Feature scaffold wiring

For each `ai.wiring` snippet from Phase B scaffolds: show targetFile + line range + description + rendered snippet. Ask `[apply / different location / edit snippet / skip]`. Never apply without consent. Search first — do not re-insert if already present.

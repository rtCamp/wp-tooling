<h1 align="center">wp-phpstan</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--2.0--or--later-blue.svg" alt="License: GPL-2.0-or-later"></a>
  <img src="https://img.shields.io/badge/PHP-8.2%2B-777bb4.svg" alt="PHP 8.2+">
  <img src="https://img.shields.io/badge/PHPStan-2.3%2B-blue.svg" alt="PHPStan 2.3+">
</p>

<p align="center">
  rtCamp's shared PHPStan baseline for WordPress projects (<code>rtcamp/wp-phpstan</code>).
</p>

---

> **Developed in [rtCamp/wp-tooling](https://github.com/rtCamp/wp-tooling/tree/main/composer-packages/phpstan).**
> The [`rtCamp/wp-phpstan`](https://github.com/rtCamp/wp-phpstan) repository is a read-only mirror, split from
> there on each release. Please open issues and pull requests in wp-tooling.

This package ships a single `phpstan.neon.dist` of rtCamp defaults (level 8, PHP 8.2–8.5, WordPress-aware
rules) and pulls in [`szepeviktor/phpstan-wordpress`](https://github.com/szepeviktor/phpstan-wordpress),
which loads the WordPress function stubs and dynamic return-type extensions PHPStan
needs to understand core.

## Install

```bash
composer require --dev rtcamp/wp-phpstan
```

This brings `phpstan/phpstan` and `szepeviktor/phpstan-wordpress` (and the WordPress
stubs) along with it — you do not need to require them separately.

## Use

Create a `phpstan.neon.dist` at your project root that includes this baseline,
then point PHPStan at your code:

```neon
includes:
    - vendor/rtcamp/wp-phpstan/phpstan.neon.dist

parameters:
    # Constants define()d in the main plugin file are only known if it is loaded.
    bootstrapFiles:
        - my-plugin.php
    paths:
        - my-plugin.php
        - inc/
    excludePaths:
        # Not reported on, but still scanned so their classes and functions resolve.
        analyse:
            - tests/ (?)
            - vendor/
        # Neither reported on nor scanned. (?) stops PHPStan failing when the path is absent.
        analyseAndScan:
            - node_modules (?)
    # Project-specific overrides and suppressions go here.
```

That single include is all you need. Run the analysis with:

```bash
vendor/bin/phpstan analyse
```

On PHP 8.3 and newer, PHPStan loads its bundled Turbo extension automatically (`vendor/bin/phpstan diagnose` shows its status); PHP 8.2 runs without it. For fast CI runs, set `tmpDir` to a path inside the project and cache it between runs: PHPStan only throws the whole result cache away when PHPStan itself or your config changes.

If the project registers WP-CLI commands, also `composer require --dev php-stubs/wp-cli-stubs` and add `vendor/php-stubs/wp-cli-stubs/wp-cli-stubs.php` under `scanFiles`. The baseline doesn't do this for you because `wp-cli-stubs` 2.12 caps `php-stubs/wordpress-stubs` at `^6.0`, which would hold every consumer back from the WordPress 7 stubs.

> **The WordPress extension must load exactly once.** This baseline already
> includes `szepeviktor/phpstan-wordpress`, and loading it twice fails PHPStan.
> So: don't include its `extension.neon` in your own neon, and if you use
> `phpstan/extension-installer`, make it skip the package in `composer.json`:
>
> ```json
> "extra": {
>     "phpstan/extension-installer": {
>         "ignore": ["szepeviktor/phpstan-wordpress"]
>     }
> }
> ```

## Overriding

Anything you set under `parameters` *after* the includes wins, so a project can
change the level, add `paths`, or add `ignoreErrors` without forking this baseline.
Per-project suppressions belong in your own neon — keep this shared file clean.

An existing project moving up to level 8 can record its current errors with `vendor/bin/phpstan analyse --generate-baseline` and include the generated `phpstan-baseline.neon`, so only new code has to pass, or set `level` lower in its own neon until it catches up.

## License

GPL-2.0-or-later. See [LICENSE](./LICENSE).

<p align="center">
  <a href="https://rtcamp.com"><img src="https://n8e0ka87m9.gdcdn.us/kfnbt046p8/GitHub_Banner.webp" alt="rtCamp" width="100%"></a>
</p>

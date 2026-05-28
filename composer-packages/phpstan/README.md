# rtcamp/wp-phpstan

rtCamp's shared [PHPStan](https://phpstan.org/) baseline for WordPress projects.

It ships a single `phpstan.neon.dist` of rtCamp defaults (level 5, WordPress-aware
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
    paths:
        - src
        - includes
    excludePaths:
        - vendor
        - node_modules
        - build
        - tests
    # Project-specific overrides and suppressions go here.
```

That single include is all you need — the baseline already pulls in
`szepeviktor/phpstan-wordpress`'s extension (the WordPress stubs and return-type
extensions), so you do not reference it yourself. Run the analysis with:

```bash
vendor/bin/phpstan analyse
```

> **Do not** also enable `phpstan/extension-installer` for `szepeviktor/phpstan-wordpress`.
> This baseline already includes that extension; auto-loading it a second time
> makes PHPStan fail on duplicate service definitions.

## Overriding

Anything you set under `parameters` *after* the includes wins, so a project can
raise the level, add `paths`, or add `ignoreErrors` without forking this baseline.
Per-project suppressions belong in your own neon — keep this shared file clean.

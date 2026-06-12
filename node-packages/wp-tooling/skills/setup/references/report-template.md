# Consolidated Final Report Template

Use this file when you're writing the consolidated final report after all phases complete (§6 of the workflow).

```
Setup complete.

Files written (Phase A):
  .editorconfig
  phpcs.xml.dist       (WordPress VIP Minimum + Docs)
  phpstan.neon.dist    (extends rtCamp wp-phpstan baseline)
  eslint.config.js
  phpunit.xml.dist
  tests/bootstrap.php
  composer.json        (PSR-4 autoload added, Acme\ImageOptimizer → includes/)

Files written (Phase B):
  includes/Cli/OptimizeImagesCommand.php
  tests/Cli/OptimizeImagesCommandTest.php

Wiring applied:
  includes/Plugin.php:43 — $this->boot('optimize-images', \Acme\ImageOptimizer\Cli\OptimizeImagesCommand::class);

Tests:
  tests/Cli/OptimizeImagesCommandTest.php — stub passing.

Developer actions (run these yourself):

  composer dump-autoload --optimize

  composer require --dev \
    automattic/vip-coding-standards:^3.0 \
    wp-coding-standards/wpcs:^3.0 \
    squizlabs/php_codesniffer:^3.7 \
    phpunit/phpunit:^12.0 \
    yoast/phpunit-polyfills:^4.0 \
    brain/monkey:^2.6

  npm install --save-dev \
    eslint@^10.0.0 \
    @wordpress/eslint-plugin@^25.1.0 \
    @rtcamp/eslint-config@^0.1.0

Scripts to add to composer.json:

  "scripts": {
    "lint:php": "phpcs --standard=phpcs.xml.dist",
    "lint:php:fix": "phpcbf --standard=phpcs.xml.dist",
    "phpstan": "phpstan analyse",
    "test": "phpunit",
    "test:unit": "phpunit --testsuite Unit",
    "test:integration": "phpunit --testsuite Integration"
  }

Scripts to add to package.json:

  "scripts": {
    "lint:js": "eslint 'src/**/*.js' 'assets/**/*.js'",
    "lint:js:fix": "eslint 'src/**/*.js' 'assets/**/*.js' --fix"
  }

Skipped: none.
Outstanding manual tasks: none.
```

Deduplicate packages. Sort alphabetically within each block. Pinned packages use exact versions; everything else uses range specifiers.

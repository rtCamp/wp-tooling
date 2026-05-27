# AI + Scaffolding examples

Realistic end-to-end conversations showing how the `setup` and `scaffold` AI skills drive `@rtcamp/wp-tooling` for common WordPress workflows.

Each example shows: what the developer typed, the AI's clarifying questions and plan, the scaffold invocations, and excerpts of the output. All examples assume `@rtcamp/wp-tooling` is on the PATH (via `npx`) and the `setup` and `scaffold` skills are in `.claude/skills/`.

---

## Example 1 — Greenfield plugin from scratch

**Developer:**

> "I'm starting a new plugin called Acme Inventory Manager. It manages products as a custom post type, with a category taxonomy. Add a CLI command to import a CSV file. WordPress.org plugin (not VIP). PHP and JS, no a11y tests yet."

**AI (setup skill):**

> Before I start, I need a few details:
>
> 1. PHP root namespace? (e.g. `Acme\InventoryManager`)
> 2. PHP source directory? (typical: `includes/`)
> 3. CLI command slug? (e.g. `import-products`)

**Developer:**

> namespace `Acme\InventoryManager`, source `includes`, command `import-products`

**AI:** Here is the plan. Please confirm.

```
Phase A — Project setup:
  1. setup/editorconfig       → .editorconfig
  2. setup/psr4               → composer.json wiring (Acme\InventoryManager → includes/)
  3. lint/phpcs/full          → phpcs.xml.dist (rtCamp full standard)
  4. lint/phpstan             → phpstan.neon.dist (level 5)
  5. lint/eslint              → .eslintrc.js
  6. setup/phpunit            → phpunit.xml.dist, tests/bootstrap.php

Phase B — Feature scaffolds:
  7. wp/cpt                   → includes/PostTypes/Product.php
  8. wp/taxonomy              → includes/Taxonomies/ProductCategory.php
  9. wp/cli                   → includes/Cli/ImportProducts.php

Skipped (already present): none.
Confirm?
```

**Developer:** confirm.

**AI runs each scaffold:**

```bash
npx wp-tooling add setup/editorconfig --non-interactive --json --cwd .
npx wp-tooling add setup/psr4         --non-interactive --json --cwd . --namespace='Acme\InventoryManager' --base_path=includes
npx wp-tooling add lint/phpcs/full    --non-interactive --json --cwd .
npx wp-tooling add lint/phpstan       --non-interactive --json --cwd .
npx wp-tooling add lint/eslint        --non-interactive --json --cwd .
npx wp-tooling add setup/phpunit      --non-interactive --json --cwd . --source_dir=includes
npx wp-tooling add wp/cpt             --non-interactive --json --cwd . --slug=product --singular=Product --plural=Products --namespace='Acme\InventoryManager' --base_path=includes
npx wp-tooling add wp/taxonomy        --non-interactive --json --cwd . --slug=product-category --singular=Category --plural=Categories --object_type=product --namespace='Acme\InventoryManager' --base_path=includes
npx wp-tooling add wp/cli             --non-interactive --json --cwd . --name=import-products --namespace='Acme\InventoryManager' --base_path=includes
```

**Wiring step** (one consent at a time):

> For `setup/psr4` I would add to `composer.json`:
>
>     "autoload": { "psr-4": { "Acme\\InventoryManager\\": "includes/" } }
>
> Apply? [yes / skip]

**Developer:** yes.

(AI applies wirings for `Plugin.php` for the CPT, taxonomy, CLI registrations one at a time.)

**Final report:**

```
Setup complete.

Files written:
  .editorconfig, phpcs.xml.dist, phpstan.neon.dist, .eslintrc.js, phpunit.xml.dist, tests/bootstrap.php
  includes/PostTypes/Product.php           + tests/PostTypes/ProductTest.php
  includes/Taxonomies/ProductCategory.php  + tests/Taxonomies/ProductCategoryTest.php
  includes/Cli/ImportProducts.php          + tests/Cli/ImportProductsTest.php

Wiring applied (3): includes/Plugin.php

Developer actions:

  composer dump-autoload --optimize

  composer require rtcamp/wp-framework:^1.0
  composer require --dev squizlabs/php_codesniffer:^3.7 wp-coding-standards/wpcs:^3.0 phpunit/phpunit:^12.0 yoast/phpunit-polyfills:^4.0 brain/monkey:^2.6
  npm install --save-dev eslint@8.57.1 @wordpress/eslint-plugin:^22.0.0 @rtcamp/wp-tooling:^1.0.0

Scripts to add to composer.json:
  "lint:php": "phpcs --standard=phpcs.xml.dist", "test": "phpunit", ...

Scripts to add to package.json:
  "lint:js": "eslint 'src/**/*.js' 'assets/**/*.js'", ...
```

---

## Example 2 — Add a CLI command to an existing plugin

**Developer:**

> "Add a WP-CLI command called `qm-export` that exports Query Monitor data as JSON."

**AI (scaffold skill, introspects project once):**

> I read your project:
> - namespace `Acme\Blog`, base path `src/`
> - bootstrap `src/Plugin/Main.php::register()`
> - CLI commands live in `src/CLI/`, classes end with `Command` (sampled from `ImportCommand`, `PurgeCommand`)
> - registration pattern: `$this->commandRegistry->add( new \Acme\Blog\CLI\X() )` (no scaffold anchor present)
> - existing commands are multi-instance (not singleton)
>
> Confirm or correct?

**Developer:** correct.

**AI invokes:**

```bash
npx wp-tooling add wp/cli --non-interactive --json \
    --namespace='Acme\Blog' --base_path='src' \
    --name=qm-export --class=QmExportCommand --singleton=false
```

**Result:** writes `src/CLI/QmExportCommand.php` and `tests/CLI/QmExportCommandTest.php`.

**Adaptive wiring:**

> The canonical wiring is `WP_CLI::add_command('qm-export', new \Acme\Blog\CLI\QmExportCommand())`, but your project uses `$this->commandRegistry->add(...)`. I would insert this at `src/Plugin/Main.php:78` (right after the last existing `commandRegistry->add` call):
>
>     $this->commandRegistry->add( new \Acme\Blog\CLI\QmExportCommand() );
>
> Apply? [yes / different location / edit / skip]

**Developer:** yes.

**AI enters the TDD loop:**

> The scaffold dropped a stub at `tests/CLI/QmExportCommandTest.php` with one `markTestIncomplete`. I will expand it into a real suite based on what `qm-export` should do, then drive the implementation test-by-test.
>
> Planned test cases for `qm-export` (Query Monitor JSON export):
>
>   1. test_command_instantiates
>   2. test_dry_run_prints_summary_and_does_not_write
>   3. test_writes_json_file_at_default_path
>   4. test_writes_json_file_at_custom_path_when_flag_set
>   5. test_outputs_valid_json_schema (top-level keys: queries, hooks, timings)
>   6. test_fails_when_query_monitor_inactive
>   7. test_warns_when_no_data_collected
>
> Confirm or add cases?

**Developer:** add a case for `--filter=queries` to limit output to one section.

**AI adds case 8, expands the test file, runs the suite:**

```bash
composer test -- --filter=QmExportCommandTest
```

```
Tests: 1 passed, 7 failed (instantiation passes; the others all fail with markTestIncomplete removed and real assertions in place).
```

**Loop, one test at a time:**

> Implementing test 2 (`test_dry_run_prints_summary_and_does_not_write`)... runs in 0.1s, passing.
> Implementing test 3 (`test_writes_json_file_at_default_path`)... passing.
> Implementing test 4... passing.
> Implementing test 5... passing.
> Implementing test 6... I assumed Query Monitor exposes a `qm_collectors` hook; checking the project's existing QM integration in `src/QueryMonitor/Bootstrap.php`... yes, I'll check `function_exists('qm_collector_registered')`. Passing.
> Implementing test 7 (warning when no data)... passing.
> Implementing test 8 (filter flag)... passing.

**Final gates:**

```bash
composer test                # full suite: 84 tests, 84 passing
composer lint:php            # 0 errors, 0 warnings
```

**Report:**

```
Added src/CLI/QmExportCommand.php (followed your Command suffix convention).
Wired into src/Plugin/Main.php:79 using your commandRegistry pattern.
tests/CLI/QmExportCommandTest.php — 8 tests, 8 passing (no markTestIncomplete remaining).
Full PHPUnit suite green; PHPCS clean.

No outstanding developer actions.
```

---

## Example 3 — Add a dynamic Gutenberg block

**Developer:**

> "Add a dynamic block called testimonial-grid."

**AI:**

> Reading your project:
> - existing blocks at `src/blocks/` with `block.json` files
> - vendor prefix sampled: `acme/` (from `acme/hero-image`)
> - bootstrap registers blocks via `register_block_type()` in `includes/Blocks/Registry.php`
>
> Plan: `npx wp-tooling add wp/block-dynamic --non-interactive --json --name=testimonial-grid --vendor=acme`
>
> Proceed?

**Developer:** yes.

**Output:**

```
Files written:
  src/blocks/testimonial-grid/block.json
  src/blocks/testimonial-grid/edit.js
  src/blocks/testimonial-grid/render.php
  src/blocks/testimonial-grid/style.scss

Wiring proposal for includes/Blocks/Registry.php:
  register_block_type( __DIR__ . '/../../src/blocks/testimonial-grid' );

Apply? [yes / different location / skip]
```

**Developer:** yes.

**AI enters the TDD loop (Jest for edit.js, PHPUnit for render.php):**

> The scaffold dropped two stubs. I'll expand both before implementing:
>
> Jest (`src/blocks/testimonial-grid/edit.test.js`):
>   1. renders without crashing
>   2. shows a placeholder when no testimonials selected
>   3. shows an InspectorControls panel with a columns count
>   4. updates the `columns` attribute when the slider changes
>   5. snapshots the saved markup
>
> PHPUnit (`tests/Blocks/TestimonialGridRenderTest.php`):
>   6. render callback returns a string (not WP_Error)
>   7. render output contains a `wp-block-acme-testimonial-grid` class
>   8. render respects the `columns` attribute (1 column → grid-cols-1, etc.)
>   9. render returns empty string when no posts found (graceful)
>
> Confirm or add cases?

**Developer:** add a case that verifies the block is registered with `show_in_rest=true`.

**AI adds case 10, expands both files, runs each suite:**

```bash
npm run test:js -- src/blocks/testimonial-grid    # 5 tests, 1 passing, 4 failing
composer test -- --filter=TestimonialGridRenderTest  # 5 tests, 0 passing, 5 failing
```

**Loop, alternating between Jest and PHPUnit as each side needs work:**

> Implementing Jest test 2 (placeholder)... passing.
> Implementing Jest test 3 (InspectorControls)... passing.
> Implementing Jest test 4 (slider updates columns)... passing.
> Implementing Jest test 5 (snapshot)... snapshot written, passing.
> Implementing PHPUnit test 6 (render returns string)... passing.
> Implementing PHPUnit test 7 (class name)... passing.
> Implementing PHPUnit test 8 (columns attribute)... passing.
> Implementing PHPUnit test 9 (graceful empty)... passing.
> Implementing test 10 (REST exposure)... passing.

**Final gates:**

```bash
npm run build           # successful
npm run test:js         # full Jest suite: 42 tests, 42 passing
composer test           # full PHPUnit suite: 88 tests, 88 passing
npm run lint:js         # 0 errors
composer lint:php       # 0 errors
```

**Report:**

```
Added src/blocks/testimonial-grid/ (block.json, edit.js, render.php, style.scss).
Wired into includes/Blocks/Registry.php.
Jest: 5 tests passing (src/blocks/testimonial-grid/edit.test.js).
PHPUnit: 5 tests passing (tests/Blocks/TestimonialGridRenderTest.php).
Build green, lint clean.
```

---

## Example 4 — CI + CD to WordPress.org

**Developer:**

> "Set up CI and CD for this plugin. Deploy to WP.org on tag. SVN slug is `acme-blog`."

**AI:**

> Reading your project:
> - no `.github/workflows/` directory yet
> - composer + npm both present
>
> Plan: `npx wp-tooling add ci/cd-wporg --non-interactive --json --plugin_slug=acme-blog`
>
> Proceed? (This scaffold has no wiring; it writes a standalone workflow file. It does declare two GitHub secrets you will need to set yourself.)

**Developer:** proceed.

**Output:**

```
Files written:
  .github/workflows/wp-org-deploy.yml

Wiring: none (workflow is standalone).

Developer actions — set these secrets yourself (I never set secrets):

  gh secret set WPORG_USERNAME --repo <owner>/<repo>
  # WordPress.org SVN username with commit access to acme-blog.

  gh secret set WPORG_PASSWORD --repo <owner>/<repo>
  # Password for the SVN account. Treat as write-only.

Branch protection recommended on main before merging.

Tests:
  actionlint .github/workflows/wp-org-deploy.yml — passing.
```

---

## Example 5 — Add a CPT + Taxonomy + REST controller together

**Developer:**

> "Add a Product post type, a Category taxonomy on it, and a REST controller for the product post type under `acmestore/v1`."

**AI:**

> Three scaffolds in this order:
>
>   1. wp/cpt        → includes/PostTypes/Product.php
>   2. wp/taxonomy   → includes/Taxonomies/Category.php
>   3. wp/rest       → includes/Rest/ProductController.php
>
> All three pull `rtcamp/wp-framework:^1.0`. Each class extends the matching abstract from the framework and is wired through the consumer's module.
>
> Confirm?

**Developer:** confirm.

**AI runs three sequential invocations:**

```bash
npx wp-tooling add wp/cpt --non-interactive --json \
    --namespace='Acme\Store' --base_path=includes \
    --slug=product --singular=Product --plural=Products

npx wp-tooling add wp/taxonomy --non-interactive --json \
    --namespace='Acme\Store' --base_path=includes \
    --slug=category --singular=Category --plural=Categories --object_type=product

npx wp-tooling add wp/rest --non-interactive --json \
    --namespace='Acme\Store' --base_path=includes \
    --name=products --class=Product --route_namespace='acmestore/v1' --singleton=true
```

**Wirings applied** (one at a time):

```
( new \Acme\Store\PostTypes\Product() )->register();
( new \Acme\Store\Taxonomies\Category() )->register();
\Acme\Store\Rest\ProductController::get_instance();
```

**Final report:**

```
Files written: 6 (3 production + 3 tests).
Wiring applied: 3 entries in includes/Plugin.php.

Developer actions:
  composer require rtcamp/wp-framework:^1.0
  composer dump-autoload --optimize
```

---

## Example 6 — Convert an existing command to singleton

The engine never overwrites. The right flow is: delete the file, re-scaffold with `--singleton=true`.

**Developer:**

> "Make `ImportProducts` a singleton command."

**AI:**

> The scaffold engine does not overwrite existing files. I will:
>
> 1. Show you the existing `includes/Cli/ImportProducts.php` so you can save any custom logic.
> 2. Delete the file (with your confirmation).
> 3. Re-run `wp/cli` with `--singleton=true`.
> 4. Help you port the saved logic into the new singleton class.
>
> Proceed?

**Developer:** show me the file first.

(AI prints the file. Developer confirms the only meaningful code is in `__invoke`. Developer confirms deletion.)

```bash
rm includes/Cli/ImportProducts.php
npx wp-tooling add wp/cli --non-interactive --json \
    --namespace='Acme\InventoryManager' --base_path=includes \
    --name=import-products --singleton=true
```

**Result:** new singleton class with `use Singleton;`, `setup()` stub, and the canonical scaffolded `__invoke` body. AI ports the original logic back into `__invoke`, updates the wiring snippet in `Plugin.php` from `new ImportProducts()` to `ImportProducts::get_instance()`.

---

## Example 7 — Brand-new feature project, all phases in one prompt

**Developer:**

> "Scaffold this empty directory as a WordPress VIP plugin called Image Optimizer. PHP only, no JS. Add a CLI command to optimize images. Include PHPUnit tests."

**AI (setup skill, asks once):**

> Confirm:
>
> 1. PHP namespace: `Acme\ImageOptimizer`?
> 2. Source directory: `includes/`?
> 3. CLI command slug: `optimize-images`?

**Developer:** yes to all.

**AI plan:**

```
Phase A — Project setup:
  setup/editorconfig, setup/psr4, lint/phpcs/vip, lint/phpstan, setup/phpunit

Phase B — Feature scaffolds:
  wp/cli (--name=optimize-images, --singleton=false)

Skipped: lint/eslint, lint/stylelint, setup/jest, setup/pa11y (no JS/CSS, no a11y tests asked).
```

**Final state after run:**

```
Files written (10), wiring applied (1 in Plugin.php for the CLI command).

Outstanding developer actions:
  composer dump-autoload --optimize
  composer require --dev automattic/vip-coding-standards:^3.0 wp-coding-standards/wpcs:^3.0 squizlabs/php_codesniffer:^3.7 phpunit/phpunit:^12.0 yoast/phpunit-polyfills:^4.0 brain/monkey:^2.6
```

---

## Key behaviours these examples illustrate

- **The AI never assumes.** Every example starts with clarifying questions for anything the developer did not state explicitly.
- **The AI confirms the plan before running anything.** Wiring proposals are shown with diff context and require explicit consent.
- **The engine never installs packages or sets secrets.** It surfaces them as a developer checklist; the human executes.
- **The engine never overwrites existing files.** Files-already-present become warnings, not silent overrides.
- **Wiring is adaptive.** Canonical snippets are translated to the project's actual registration pattern by sampling existing code.
- **Multiple scaffolds chain cleanly.** The `setup` skill orchestrates Phase A (tooling) and Phase B (features); the `scaffold` skill handles one-off feature additions.
- **TDD is the default for feature work.** The engine writes thin test stubs; the AI expands them into a real suite (PHPUnit for PHP, Jest for JS, both where the feature spans both), then iterates red → green → refactor with the test runner in the loop. No `markTestIncomplete` survives. The full suite plus lint must be green before the AI reports done.

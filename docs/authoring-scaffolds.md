# Authoring scaffolds

How to add, update, or remove a scaffold in `@rtcamp/wp-tooling`. Designed to keep the catalogue easy to maintain.

---

## TL;DR

Drop a directory in `scaffolds/` with a `scaffold.json` manifest and (usually) one or more Mustache templates. The registry auto-discovers it on the next `list` or `add` invocation. No code changes required.

```
scaffolds/
  <category>/                     # optional grouping (kebab-case, slash-nested allowed)
    <slug>/                       # scaffold id (kebab-case)
      scaffold.json               # manifest
      templates/                  # mustache files referenced from scaffold.json
        *.mustache
```

Discoverable IDs follow the directory: `wp/cli`, `lint/phpcs/full`, `setup/editorconfig`. The recursive scanner finds `scaffold.json` at any depth.

---

## Add a new scaffold

1. **Pick the location.** Decide the `category` (top-level grouping like `wp`, `lint`, `setup`, `block`) and `slug` (kebab-case identifier). Create `scaffolds/<category>/<slug>/`.

2. **Write `scaffold.json`.** Required fields: `slug`, `name`, `description`, `source`, `files`. Optional fields documented in [docs/ai-orchestration.md](ai-orchestration.md) §3.

3. **Add templates** in `templates/`. Use Mustache syntax — see [Template syntax](#template-syntax) below.

4. **Verify discovery:**

   ```bash
   node bin/wp-tooling.js list --json | grep <slug>
   ```

5. **Render once to sanity-check:**

   ```bash
   node bin/wp-tooling.js add <category>/<slug> --non-interactive --cwd /tmp/test --dry-run --json
   ```

6. **Run the test suite** to confirm the manifest validates:

   ```bash
   npm test
   ```

   Validation errors fail the registry scan tests immediately.

---

## Update an existing scaffold

- **Add a new input:** append to the `inputs[]` array. Always give it a `default` or mark `required: false`, otherwise existing consumers break.
- **Add a new template variable:** add the placeholder in the template AND a matching entry in `inputs[]`. Inputs without an entry are inferred from placeholders only as a fallback — declare them explicitly.
- **Add a new file output:** append to `files[]`. The engine never overwrites existing files; new outputs land safely alongside existing ones.
- **Change a default:** safe for downstream consumers but flag it in the CHANGELOG. Behavioural changes are easy to miss.
- **Bump a dependency version:** edit `composer_dependencies`, `composer_dev_dependencies`, `npm_dependencies`, etc. The engine surfaces these to the developer as install instructions; nothing is auto-installed.

After any update, run `npm test` and a manual `--dry-run` invocation to catch render or validation errors.

---

## Remove a scaffold

1. Delete the `scaffolds/<category>/<slug>/` directory.
2. Run `npm test` — nothing should fail (the registry tests use fixtures, not the live catalogue).
3. Note the removal in the CHANGELOG with a brief reason. Downstream projects that were referencing the scaffold will fail with `ENOSCAFFOLD` and see the available list, so the error path is helpful.

There is no soft-deprecation. If you need a transition period, keep the old scaffold and add a `description` note pointing at the replacement.

---

## Template syntax

The renderer (`src/scaffolds/render.js`) is a hand-rolled Mustache subset. Zero runtime dependencies.

### Variable substitution

```mustache
namespace {{namespace}}\Cli;
class {{class}} { }
```

`{{key}}` is replaced with `vars[key]`. Whitespace inside the braces is allowed: `{{ key }}` works the same. Undefined placeholders throw `ERENDERFAIL` — no silent empty substitution.

### Sections (conditional blocks)

```mustache
{{#singleton}}use RtCamp\WPToolkit\Traits\Singleton;
{{/singleton}}use WP_CLI;
```

`{{#key}}...{{/key}}` renders the inner block when `vars[key]` is truthy. Truthy means a non-empty string that is not one of `"false"`, `"no"`, `"0"` (case-insensitive).

### Inverted sections

```mustache
{{^singleton}}// multi-instance class
{{/singleton}}
```

`{{^key}}...{{/key}}` renders the inner block when `vars[key]` is falsy. Useful as a pair with the positive section to keep blank-line spacing clean for both modes.

### Not supported

- Partials (`{{> name}}`)
- Iteration over arrays (`{{#list}}item: {{.}}{{/list}}` with array values)
- Comments (`{{! comment}}`)
- Set delimiters

If a scaffold ever needs one of these, extend `render.js` rather than working around it. Add tests in `tests/scaffolds/render.test.js`.

### HTML escape is OFF

Templates render code (PHP, JS, YAML, JSON). HTML escaping is explicitly disabled to avoid mangling generated output. Treat this as load-bearing — do not "fix" it.

---

## Inputs: how the engine resolves them

The `inputs[]` array is the authoritative declaration. For each input the engine resolves a value in this order:

1. Explicit `--key=value` passed to `add`.
2. Discovery (currently supports `input:<other-key>` for derivation; e.g. `class` derived from `name` via the `pascal-case` transform).
3. `default`.
4. Error `EMISSINGINPUT` if the field is `required: true`.

When `inputs[]` is omitted, the engine falls back to scanning template placeholders (with `collectPlaceholders`) and requires every placeholder to be supplied. The explicit `inputs[]` block is always preferable: it lets you document the input, set defaults, declare transforms, and gate `required`.

### Transforms

Available via `transform`:

- `pascal-case`: `qm-export` → `QmExport`
- `kebab-case`: `QmExport` → `qm-export`
- `snake-case`: `qm-export` → `qm_export`
- `upper-snake-case`: `wporg-username` → `WPORG_USERNAME`

Transforms are applied after the value is resolved. Add new transforms in `src/scaffolds/render.js` (`TRANSFORMS` map).

### Boolean inputs

There is no `boolean` type in the schema. Use a string input with `"true"` / `"false"` values and a `default`, and check it in templates with `{{#key}}...{{/key}}` or `{{^key}}...{{/key}}`.

Example (from `wp/cli`):

```json
{
    "key": "singleton",
    "description": "Use the Singleton trait. Pass 'true' or 'false'.",
    "default": "false"
}
```

---

## Wiring (`wiring[]`)

The engine never edits existing files. When a scaffold needs to register itself in `Plugin.php`, `composer.json`, or any other existing file, emit a `wiring` entry. The AI orchestrator (or developer) applies it with consent.

Each entry:

- `target_file`: path to the file. Placeholders allowed.
- `anchor`: grep-able string that hints at insertion point (e.g. `// scaffold:cli-commands`). Anchors are useful but not load-bearing; the AI falls back to pattern sampling.
- `snippet_template`: the snippet to insert. Mustache placeholders are rendered before the snippet is emitted.
- `description`: explains intent. The AI uses this when asking the developer for consent.

Use sections inside `snippet_template` to vary the snippet by flag (e.g. the singleton vs multi-instance registration in `wp/cli`).

---

## Tests, secrets, scripts

- `tests[]`: test stubs written alongside production output. Each entry has `src`, `dest`, `framework` (`phpunit`, `jest`, `playwright`, `pa11y`, `actionlint`, `yaml-parse`), and optional `command`.
- `secrets[]`: declarations only — never values. Each entry has `key` (UPPER_SNAKE_CASE), `scope` (`github-actions`, `env`, `dotenv`), `description`, and optional `required`.
- `scripts.npm` / `scripts.composer`: maps of `{ name: command }` the developer should add to their `package.json` / `composer.json`. The engine surfaces these in the report; nothing is auto-merged.

---

## Dependency maps

- `composer_dependencies`: runtime PHP deps the scaffold needs.
- `composer_dev_dependencies`: dev-only.
- `composer_suggest`: optional suggestions.
- `npm_dependencies`, `npm_dev_dependencies`: same for JS.

The engine merges all dependency maps from selected scaffolds (via `collectDependencies`). The AI surfaces them as `composer require ...` / `npm install ...` instructions — never runs them.

---

## Categories and nesting

`category` accepts kebab-case with slashes (`lint/phpcs`, `setup`, `wp`). The combined id is `<category>/<slug>`. Two-level: `wp/cli`. Three-level: `lint/phpcs/vip`.

Use nesting when a scaffold has multiple variants of the same concept (PHPCS standard choice). Use a flat category when scaffolds are independent (`setup/editorconfig`, `setup/psr4`, `setup/phpunit`).

---

## Versioning and the catalogue

Scaffolds are versioned with the package as a whole. Breaking changes to a scaffold's input contract (renaming a required input, removing one without a default) count as semver-minor. Adding new optional inputs is patch.

When in doubt, ship the change behind a new scaffold ID (e.g. `wp/cli/v2`) rather than breaking the existing one.

---

## Common patterns to copy from

Look at these existing scaffolds when authoring a new one:

| Need | Look at |
|---|---|
| Simple PHP class with PHPUnit stub | `wp/cli` |
| PHP class extending a base from wp-php-toolkit | `wp/rest`, `wp/cpt`, `wp/taxonomy`, `wp/cron` |
| Static config file (no inputs) | `setup/editorconfig` |
| Wiring into an existing JSON file | `setup/psr4` |
| Multiple variants of the same concept | `lint/phpcs/{full,core,vip}` |
| Block scaffold with `block.json` + render.php | `block/dynamic` |
| Workflow / YAML scaffold with secrets | `ci/cd-wporg` |
| `source: "package"` (no files, only boot wiring) | `utility/cache` |

Copy the closest match, rename, adjust. Most scaffolds are 20-50 lines of JSON plus one template file.

---

## When to involve `wp-php-toolkit`

If your new scaffold extends or uses a class from `rtcamp/wp-php-toolkit` that does not yet exist, add the contract to [docs/wp-php-toolkit-contract.md](wp-php-toolkit-contract.md) and open an issue on `wp-php-toolkit`. Do not ship a scaffold that references an unreleased class — it will break for consumers running `composer install`.

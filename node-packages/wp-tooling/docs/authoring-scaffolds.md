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
{{#with_logging}}use {{namespace}}\Services\Logger;
{{/with_logging}}use rtCamp\WPFramework\Contracts\Interfaces\Registrable;
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
2. `discover_from` (see below).
3. `default`.
4. Error `EMISSINGINPUT` if the field is `required: true`.
5. Error `EINVALIDINPUT` if the resolved value falls outside a declared `enum`.

An explicit value always wins over discovery, so AI/CLI callers are never overridden.

### `discover_from` sources

`discover_from` reads a value from elsewhere. Every source is **fallback-safe**: when the file
or key is absent the input falls through to its `default` (so a project without the file behaves
exactly as if `discover_from` were not set).

- `input:<other-key>` — derive from another resolved input (e.g. `class` from `name`, with a `pascal-case` transform).
- `composer.json:<dot.path>` / `package.json:<dot.path>` — a string value at a dotted path. The special selector `autoload.psr-4` (or `autoload.psr-0`) yields the **root namespace** for ordinary inputs (first map key, trailing `\` stripped) and the **root directory** for path inputs (that same entry's value; the first element if it is a list). Either way the discovered root replaces only the *first segment* of the input's `default`, keeping the scaffold's sub-namespace or sub-directory: with a map of `Acme\Blog\` → `inc/`, a `namespace` default of `Inc\Cli` yields `Acme\Blog\Cli` and a `base_path` default of `includes/Cli` yields `inc/Cli`. Both come from the same map entry, so a class is never namespaced into the autoload root while being written outside it. A path input whose `default` has no sub-directory resolves to the root directory itself, and a PSR-4 target of `./` leaves just the sub-directory.
- `config:<dot.path>` — a string value from the project's `.wp-tooling.json` (e.g. `config:textDomain`).

Example — auto-fill the namespace from the consuming project's composer.json, falling back to a sensible default:

```json
{
    "key": "namespace",
    "description": "PSR-4 namespace for the class.",
    "discover_from": "composer.json:autoload.psr-4",
    "default": "Inc\\Cli"
}
```

When `inputs[]` is omitted, the engine falls back to scanning template placeholders (with `collectPlaceholders`) and requires every placeholder to be supplied. The explicit `inputs[]` block is always preferable: it lets you document the input, set defaults, declare transforms, and gate `required`.

### Transforms

Available via `transform`:

- `pascal-case`: `qm-export` → `QmExport`
- `kebab-case`: `QmExport` → `qm-export`
- `snake-case`: `qm-export` → `qm_export`
- `upper-snake-case`: `wporg-username` → `WPORG_USERNAME`
- `json-escape`: `Acme\Blog` → `Acme\\Blog` (embed a PHP namespace in a JSON snippet)

Transforms are applied after the value is resolved. Add new transforms in `src/scaffolds/render.js` (`TRANSFORMS` map).

### Constraining values with `enum`

When an input only makes sense as one of a fixed set, declare `enum`. The engine checks the
**resolved** value (after any `transform`) and throws `EINVALIDINPUT` naming the allowed set, so a
typo fails at `add` time instead of rendering code that silently does nothing:

```json
{
    "key": "mode",
    "description": "Speculative loading mode.",
    "enum": ["auto", "prefetch", "prerender"],
    "default": "prerender"
}
```

`validate` additionally rejects a `default` that is not one of its own `enum` members, since that
combination would fail on every run. See `wp-api/speculation` for a live example.

### Boolean inputs

There is no `boolean` type in the schema. Use a string input with `"true"` / `"false"` values and a `default`, and check it in templates with `{{#key}}...{{/key}}` or `{{^key}}...{{/key}}`. Add `"enum": ["true", "false"]` to reject anything else.

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

## Features (`feature{}`) — toggleable scaffolds

An optional `feature` block turns a scaffold into something `wp-tooling features` can switch on and
off (e.g. Tailwind). It is additive: scaffolds without it behave exactly as before, and the
`add` (AI) path ignores it entirely.

```json
"feature": {
    "config_key": "tailwind",
    "owned_files": [ "postcss.config.js" ],
    "confirm_remove": [ "src/css/frontend/tailwind.css" ],
    "gitignore": [ "_tailwind-theme.css" ]
}
```

- `config_key` (required): the key under `features{}` in `.wp-tooling.json` that records on/off.
- `owned_files`: files this feature creates that are safe to delete on disable (rendered like `dest` paths).
- `confirm_remove`: developer-editable files deleted only after explicit confirmation.
- `gitignore`: lines added on enable, removed on disable. Omit lines the project's base `.gitignore` already ships (otherwise disable would strip a pre-existing rule).

The CLI:

```bash
wp-tooling features                       # interactive, one prompt per feature (defaulted to current state)
wp-tooling features --enable tailwind     # non-interactive
wp-tooling features --disable tailwind --force   # remove developer-editable files without asking
wp-tooling features --json                # machine-readable status
```

Programmatically the registry exposes `enable(id, inputs, opts)`, `disable(id, opts)` (opts may
include an async `confirmRemove(path)` callback), and `status(cwd)`. The engine **reports** the
feature's `npm_dev_dependencies` but never installs them — the feature-manager driver does.
`--no-install` (`install: false`) skips the install and only reports the deps; add
`--record-deps` (`record: true`) to also write the missing entries into `package.json` so the
next plain `npm install` brings them in (for init scripts that themselves run inside
`npm install`).

On enable, the rendered `owned_files` / `confirm_remove` / `gitignore` paths are persisted under
`featureFiles{}` in `.wp-tooling.json`; disable removes exactly those paths (falling back to
re-rendering the manifest templates when nothing was persisted).

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

`wp` holds the framework-shaped kinds (a CPT, a REST controller, a CLI command). `wp-api` holds scaffolds that customise a **modern WordPress core API** — code whose shape is dictated by core's own hooks and which must be guarded against the WordPress version that introduced them (`wp-api/speculation`, Speculation Rules, WP 6.8; `wp-api/block-bindings` and `wp-api/script-module`, both WP 6.5). Those pair with `"wizard_step": "wp-apis"`.

A block stays in `wp` even when its behaviour comes from a modern core API: `wp/block-interactive` uses the Interactivity API, but what it generates is a block directory, so it sits beside `wp/block-dynamic` and shares its wiring anchor rather than opening a `block` category.

---

## Remote scaffolds via per-repo sources + an upstream index

Most scaffolds live entirely inside `wp-tooling` (a `scaffold.json` + templates under `scaffolds/`). A scaffold can instead live **in another repo** — useful when that repo owns the thing being generated, e.g. the `ci/*` callers into `rtCamp/wp-shared-workflows`. In that case the *whole* scaffold (its `scaffold.json` and templates) lives in the owning repo. `wp-tooling` lists only the **repos** (sources); each owning repo publishes its own **index** of the scaffolds it offers.

The upshot: adding, changing, or registering a remote scaffold is **a single PR in the owning repo** — `wp-tooling` only changes when you onboard a *new repo*. A remote scaffold's `scaffold.json` is an **ordinary manifest** — there is no special `source` value or `repository` field inside it. Remoteness is expressed entirely by the source + index. The same files can move between local and remote with zero manifest edits.

### Authoring a remote scaffold

**1. In the owning repo** (e.g. `rtCamp/wp-shared-workflows`), add a normal scaffold directory plus a root index that lists it:

```
scaffolds/
  index.json               # lists the scaffolds this repo offers
  ci/test-php/
    scaffold.json          # ordinary manifest: source "template", inputs, files, ...
    ci-test-php.yml.mustache
```

`scaffolds/index.json`:

```json
{
  "scaffolds": [
    {
      "id": "ci/test-php",
      "path": "ci/test-php",
      "name": "CI: PHPUnit",
      "description": "GitHub Actions workflow calling rtCamp/wp-shared-workflows ci-test-php.yml.",
      "checksum": "sha256:…"
    }
  ]
}
```

`name`/`description` live here so wp-tooling's `list` has something to show without fetching every manifest; `path` is the scaffold's directory relative to the source `path`; `checksum` is optional — when present it is the hex SHA-256 of the scaffold's `scaffold.json` body (with or without a `sha256:` prefix), and the engine verifies the fetched manifest against it on `add`, failing with `EBADSCAFFOLD` on mismatch. Because the templates sit next to the manifest, this is a fully self-contained local scaffold *from that repo's point of view*. Validate it there in CI without making the repo a Node project:

```yaml
- run: npx --yes @rtcamp/wp-tooling validate ./scaffolds/ci/test-php
```

(`npx` fetches wp-tooling ephemerally — no `package.json`, no committed `node_modules`.) Then tag the repo (e.g. `v1`).

**2. In `wp-tooling`**, add the *repo* to `scaffolds/sources.json` (only needed the first time a repo is onboarded):

```json
{
  "sources": [
    {
      "repository": "rtCamp/wp-shared-workflows",
      "ref": "v1",
      "path": "scaffolds"
    }
  ]
}
```

On scan, the engine fetches `<repository>/<ref>/<path>/index.json` to discover the repo's scaffolds. On `add ci/test-php`, it fetches that scaffold's `scaffold.json`, validates it, then fetches each `files[].src` from the same directory and renders exactly as a local scaffold. A scaffold id must be unique across local scaffolds and every source (a collision is a hard `EBADSCAFFOLD` at scan).

### Two different refs

Don't confuse them:

- **`source.ref` (sources.json)** — the version of the owning repo wp-tooling *fetches scaffolds from*. A literal pin the team controls (use a tag or SHA). Bumping it is a wp-tooling change.
- **A `wsw_ref` *input*** declared by the scaffold — renders into the generated workflow's `uses: ...@<ref>` line, i.e. which workflow version the consumer's CI *calls at runtime*. A normal input with its own default.

They are usually the same value but are independent knobs.

### Caching, auth, offline behaviour

- **Caching.** The index, manifests, and templates are cached under `${XDG_CACHE_HOME:-$HOME/.cache}/wp-tooling/remote/` and validated with HTTP conditional requests (ETag / `If-None-Match`): a `304 Not Modified` serves the cached copy, so content is re-downloaded only when it actually changes at the pinned ref. A SHA pin never changes; a movable tag (`v1`) refreshes when it moves. `npx wp-tooling add ... --refresh` forces a re-fetch; `npx wp-tooling cache clear` empties the cache.
- **Auth.** Public repos need no setup. For private repos or to dodge the unauthenticated `raw.githubusercontent.com` rate limit, export `WP_TOOLING_GITHUB_TOKEN`; it is sent as `Authorization: Bearer ...`.
- **`list`** reads the repo index (cached). It is **online-preferred with a cache fallback**: it shows remote scaffolds (`origin: "remote"`, `counts: null`) from the last-seen index, and when a source is unreachable and uncached it is skipped with a warning rather than failing the whole list. A `--dry-run` on a remote scaffold fetches just the (small, cached) manifest to produce the plan and never fetches template bodies.
- **`validate`** is offline by default: it checks `sources.json`'s shape and recognises remote ids from any **cached** index (so `validate ci/test-php` resolves after a prior run). Pass **`--remote`** to fetch each repo's index + each manifest at its pinned ref and schema-validate them (honours `--refresh` / `--cache-dir`); a network/HTTP failure reports as an `EFETCHFAIL` row, a bad index/manifest as schema errors, and a remote id colliding with a local scaffold is flagged. `--remote` checks manifests only — template correctness is verified in the owning repo (step 1) and at `add` time.

### When to use it

Only when the scaffold genuinely belongs to another repo that owns its content. `setup/*`, `lint/*`, and `wp/*` scaffolds are self-contained and stay local forever. Remote sourcing trades a network round trip + a cross-repo dependency for the ability to ship a scaffold's changes from one repo PR.

---

## Versioning and the catalogue

Scaffolds are versioned with the package as a whole. Breaking changes to a scaffold's input contract (renaming a required input, removing one without a default) count as semver-minor. Adding new optional inputs is patch.

When in doubt, ship the change behind a new scaffold ID (e.g. `wp/cli/v2`) rather than breaking the existing one.

---

## Common patterns to copy from

Look at these existing scaffolds when authoring a new one:

| Need | Look at |
|---|---|
| Plain class implementing `CLICommand` with PHPUnit stub | `wp/cli` |
| PHP class extending a framework abstract | `wp/cpt`, `wp/taxonomy`, `wp/rest`, `wp/shortcode`, `wp/admin-page`, `wp/settings-page`, `wp/user-role` |
| Cron handler implementing `Registrable` directly | `wp/cron` |
| Version-guarded customisation of a core WP API | `wp-api/speculation` |
| Registering something into a core registry on `init` | `wp-api/block-bindings` |
| PHP class paired with a JS asset the build compiles | `wp-api/script-module` |
| Module that hosts other Registrable classes | `wp/module` |
| Static config file (no inputs) | `setup/editorconfig` |
| Wiring into an existing JSON file | `setup/psr4` |
| Multiple variants of the same concept | `lint/phpcs/{full,core,vip}` |
| Block with `block.json` + framework class | `wp/block-dynamic` |
| Block with `render.php` + a `viewScriptModule` store | `wp/block-interactive` |
| Workflow / YAML scaffold with secrets | `ci/cd-wporg` |
| Scaffold hosted in another repo (sources + index) | `scaffolds/sources.json` + `tests/fixtures/scaffolds-sources/sources.json` |

Copy the closest match, rename, adjust. Most scaffolds are 20-50 lines of JSON plus one template file plus a test stub.

---

## When to involve `wp-framework`

If your new scaffold extends or uses a class from `rtcamp/wp-framework` that does not yet exist, add the contract to [docs/wp-framework-contract.md](wp-framework-contract.md) and open an issue on `wp-framework`. Do not ship a scaffold that references an unreleased class. It will break for consumers running `composer install`.

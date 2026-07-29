---
name: accessibility
description: Audit and fix WCAG accessibility violations on the running dev site using `wp-tooling a11y` (pa11y-ci). Runs the scan, triages violations by WCAG criterion and impact, maps each one to the theme/plugin source that rendered it, proposes minimal fixes with consent, and re-verifies until clean. Use whenever the developer mentions accessibility, a11y, WCAG, pa11y, screen readers, contrast, alt text, ARIA, keyboard navigation, or asks to audit or fix accessibility issues — even if they do not name a tool.
---

# accessibility

Find → fix → re-check accessibility violations. Run the project's pa11y scan through `wp-tooling a11y`, turn each violation into a source-mapped fix, apply it with consent, and prove it gone with a re-run.

## Use for

- Auditing the dev site for WCAG violations across the URLs in the project's pa11y config.
- Fixing violations the scan reports: missing alt text, unlabelled form controls, ARIA misuse, heading order, contrast, landmark structure.
- Re-verifying accessibility after template, block, or markup changes.

## Do not use for

- Static code review without a running site — the runner scans live URLs.
- Performance, SEO, or i18n findings — separate lens skills cover those.
- Rewriting WordPress core or third-party plugin markup — report those instead (§4).

## The runner

`npx wp-tooling a11y` shells out to the consumer project's own `pa11y-ci` dev dependency and prints a normalised report. URLs come from the pa11y config only — `.pa11yci.json` at the project root by default, or any config handed over with `--config <path>`. A project that already has its own pa11y setup works as-is; nothing here requires a particular scaffold.

| Flag | Meaning |
|---|---|
| `--config <path>` | pa11y config to use (default `.pa11yci.json`) |
| `--output <text\|json>` | output format — always use `json` in this skill |
| `--dry-run` | print the resolved binary, config and URLs; run nothing |

| Exit | Meaning | Response |
|---|---|---|
| 0 | clean | report and stop |
| 1 | run failure or unreachable URL | environment problem — see §2, never a code fix |
| 2 | usage error, pa11y-ci missing, or no URLs in the config | close the preflight gap (§1) |
| 3 | violations found | the normal working state — parse and proceed |

Normalised JSON shape (stdout):

```
{ tool: 'pa11y-ci', standard: 'WCAG2AA',
  summary: { urls, violations, errors, warnings, notices, passedUrls, failedUrls },
  results: [ { url, scanError,
               violations: [ { id, wcagCriterion, impact, runner, message,
                               selector, context, domHints } ] } ] }
```

`domHints` — `{ tagName, classList, idAttr, attrs }`, extracted from the violation's context HTML — is the bridge from finding to source: grep the repo with it (§4).

## Workflow

Before any other work, write a TODO list covering steps 1–7 below and keep it updated as you go (exactly one entry `in_progress` at a time).

### 1. Preflight

- **Config.** Locate the pa11y config: `.pa11yci.json` at the project root is the default; if the project keeps one elsewhere, pass it with `--config`. Read it and note the `urls` list.
- **Neither config nor pa11y-ci present?** Offer `npx wp-tooling add setup/pa11y --non-interactive --json --base-url=<dev url>` — it writes `.pa11yci.json` and adds `pa11y-ci` to `devDependencies`. Surface the `npm install` as a developer action; never run it yourself.
- **Both engines.** Check `defaults.runners` in the config. pa11y's default is htmlcs only; axe catches rules htmlcs misses. If absent, offer the one-line edit `"runners": ["axe", "htmlcs"]` with consent.
- **Dev site up.** Probe the first configured URL (`curl -s -o /dev/null -w '%{http_code}'`). If it does not respond, surface how to start it (`npx wp-env start` or the project's own script) as a developer action, or run it with consent.
- **Show the plan.** `npx wp-tooling a11y --dry-run` (plus `--config` if non-default) — confirm the resolved binary, config and URL list with the developer before scanning.

### 2. Run checks

```bash
npx wp-tooling a11y --output json          # append --config <path> for a non-default config
```

- Exit 3 means violations to work on, not an error. Parse stdout as JSON.
- Exit 0 means clean: report `summary` and stop.
- Exit 1 with `summary.failedUrls > 0`: one or more URLs did not load — read each `results[].scanError`, fix the environment (server down, wrong port, wrong base URL in the config), and re-run. A `scanError` is never something to fix in project code.
- Do not invoke `pa11y-ci` directly or re-implement its invocation — the runner owns binary resolution and report normalisation.

### 3. Triage

- Group violations by `id` — the same id across many URLs or nodes is usually one underlying template fix.
- Rank groups by impact: `error` first, then `warning`. List `notice` groups (capped at 10) but do not fix them unless asked.
- Present a ranked table: id, wcagCriterion, impact, occurrence count, affected URLs, one example message.
- Confirm with the developer which groups to fix this session. Do not edit anything before that confirmation.

### 4. Locate source

For each confirmed group, find the code that renders the failing node:

- Grep with the strongest hint first: `domHints.idAttr`, then a distinctive `domHints.classList` entry, then attribute values from `domHints.attrs`, then literal text near the node in `context`.
- Search theme/plugin source: PHP templates and template parts, block `render.php` / `render_callback`s, PHP that echoes markup, JS that builds DOM. Never search `vendor/`, `node_modules/`, or build output — a hit in `build/` means trace back to the `src/` file that generates it.
- **Ownership check.** Markup rendered by WordPress core or a third-party plugin (login page chrome, core widgets, embeds) is not fixable in project source. Classify the group as **upstream**, note the available remedies (filter/hook override, template override, upstream report) and move on.
- Read 2–3 nearby render sites so the fix matches house style — escaping helpers, i18n functions, class naming.
- If a group cannot be traced, say so and carry it to the report untouched rather than guessing.

### 5. Fix (with consent)

- Propose the minimal source edit that resolves the group: alt text, `label`/`for` association, an ARIA attribute, a heading level, a contrast token. No drive-by refactors.
- Show the diff with file and line range; ask `[apply / edit / skip]`. Apply only on approval.
- Every new user-facing string is translatable (`__()` with the project text domain) and escaped per house style.
- One group at a time: fix → re-check (§6) → next group.

### 6. Re-check

- If the fix touched built assets, surface `npm run build` as a developer action first (or run it with consent).
- Re-run `npx wp-tooling a11y --output json`. Confirm the group's `id` + `selector` pairs are gone from the affected URLs and that no new violations appeared.
- Large config? Scope the re-run: copy the config, keep only the affected `urls`, pass the copy with `--config`, delete it afterwards.
- If the same violation survives 3 fix attempts, stop and report: what you tried, what you observed, what is blocking, and 1–3 specific options. Do not keep iterating in silence.

### 7. Report

- Before/after `summary` counts: violations, errors, warnings, passedUrls.
- Fixes applied: file:line per group, with its wcagCriterion.
- Upstream findings (core / third-party) with suggested remedies — reported, not fixed.
- Untraced or skipped groups, with reasons.
- Outstanding developer actions: installs, builds, environment commands.

## Hard rules — never violate

- Never run `npm install`, `composer require`, or any package-manager command without explicit consent — surface them as developer actions.
- Never apply an edit without showing the diff and receiving consent.
- Never edit `vendor/`, `node_modules/`, WordPress core, or generated build output.
- Never treat a `scanError` (unreachable URL) as a code problem — it is an environment problem.
- Never silence a violation instead of fixing it — no `aria-hidden` on failing content, no pa11y ignore rules — unless the developer explicitly asks for a documented exception.
- Never lower the standard (e.g. `WCAG2AA` → `WCAG2A`) or drop URLs from the config to make a run pass.
- Never commit, push, or open PRs without explicit consent.

## Reference

- Runner source: `node_modules/@rtcamp/wp-tooling/src/a11y/`
- Report shape + `domHints` extraction: `node_modules/@rtcamp/wp-tooling/src/a11y/normalize.js`
- Config + dependency scaffold: `npx wp-tooling add setup/pa11y`
- WCAG quick reference: https://www.w3.org/WAI/WCAG22/quickref/

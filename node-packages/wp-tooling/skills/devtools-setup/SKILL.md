---
name: devtools-setup
description: Get wp-dev-tools connected on a project — check prerequisites, enable it, connect the MCP client, verify the loop, and troubleshoot when broken. Works even if the project never ran the init engine. Use when the developer mentions dev-tools, wp-dev-tools, MCP, `/mcp`, Query Monitor, the MCP Adapter, `dev:connect`, or asks to set up, connect, verify, or fix the dev-tools integration.
---

# devtools-setup

Check → enable → connect → verify → troubleshoot: gets wp-dev-tools working on a project end to end, or finds out why it isn't.

Naming gotcha: the GitHub repo is `rtCamp/wp-devtools` (no hyphen before "tools"). The Composer package, MCP server ID, route namespace, and ability prefix are all `wp-dev-tools` (hyphenated). Use the hyphenated form everywhere below except the repo URL.

## Use for

- Connecting wp-dev-tools on a project, whether or not it used the init engine.
- Diagnosing a broken or incomplete connection, or re-verifying after an environment change.

## Do not use for

- General plugin/theme scaffolding (`setup`) or one-off feature scaffolds (`scaffold`).
- Audits (a11y/perf/security) once wp-dev-tools is already connected — separate lens skills.

## The commands

| Command | Does |
|---|---|
| `npm run init -- --enable=dev-tools` | Manage-mode toggle (needs `.wp-scaffold.json`). Adds the Composer wiring, writes `.wp-env.override.json`, and the `dev:connect`/`dev:disconnect` scripts — exact contents in §2. Confirms before writing unless `-y`. |
| `npm run dev:connect` | `claude mcp add wp-dev-tools -- <wp-cli runner> -- wp mcp-adapter serve --server=wp-dev-tools --user=admin` (STDIO; no `.mcp.json`). Via the init engine, `<wp-cli runner>` is always `npx wp-env run cli` — hardcoded in `dev-tools.js`, wp-env only. Wiring by hand on another environment: substitute how that environment runs WP-CLI. `dev:disconnect` runs `claude mcp remove wp-dev-tools`. |
| `/mcp` | Confirms the `wp-dev-tools` server is connected. |
| `bash bin/dev-tools-e2e.sh` (if present) | The reference consumer's verify smoke — boot+gate, abilities, MCP route, `tools/list` allow-list, capture loop, CWV beacon, adapter isolation. Exit `0`/`1`/`2` = pass/fail/prerequisite-missing. Not every project has this script — see §4 for the manual equivalent. |

## Workflow

Track the 5 steps below as a TODO list, one `in_progress` at a time.

### 1. Check (Preflight)

WordPress ≥ 6.9 (`wp core version`); PHP version against `rtcamp/wp-dev-tools`'s `composer.json` constraint; Query Monitor + MCP Adapter available; local env — `wp-env`, `vip dev-env`, or anything else (Local by Flywheel, a bare server); whether `.wp-scaffold.json` exists (picks the branch below); `RT_DEV_TOOLS_DEV_MODE` — the gate that actually turns dev-tools on (§2); an MCP client to connect to. Report every gap with its exact fix — print install commands, don't run them.

### 2. Install / enable

| Project state | Action |
|---|---|
| `.wp-scaffold.json` exists | `npm run init -- --enable=dev-tools` (manage mode). Never `--features=` — it sets the exact enabled set and would disable other defaults (e.g. `hmr`). Revert with `--disable=dev-tools`. |
| wp-tooling present, never initialized | Don't run `npm run init` yourself — first run is a full scaffold wizard (project identity, capabilities), not a toggle. Ask the developer to run it once, then retry. |
| No init engine | Wire by hand — below. |

**Manual wiring** (no init engine at all):

1. `composer.json` — add both:
   ```json
   "repositories": [{ "type": "vcs", "url": "https://github.com/rtCamp/wp-devtools.git", "no-api": true }],
   "require-dev": { "rtcamp/wp-dev-tools": "<current constraint>" }
   ```
   The constraint is pre-release (`dev-release/v1.0.0` as of this writing, since wp-dev-tools has no tagged release yet) — check its current recommended constraint rather than assume this one still holds.
2. Local config — same six settings either way: `WP_ENVIRONMENT_TYPE`, `SAVEQUERIES`, `RT_DEV_TOOLS_DEV_MODE`, and the three `RT_DEV_TOOLS_TELEMETRY_*` keys, plus Query Monitor + the MCP Adapter plugin.
   - **wp-env**: create `.wp-env.override.json` if absent, **gitignored**, never edit the committed `.wp-env.json`:
     ```json
     { "env": { "development": {
       "plugins": [
         "https://downloads.wordpress.org/plugin/query-monitor.zip",
         "<current MCP Adapter release zip — check bin/features/dev-tools.js for the pinned URL>"
       ],
       "config": {
         "WP_ENVIRONMENT_TYPE": "local",
         "SAVEQUERIES": true,
         "RT_DEV_TOOLS_DEV_MODE": true,
         "RT_DEV_TOOLS_TELEMETRY_CONTAINER_ROOT": "/var/www/html/wp-content/<plugins-or-themes>/<project-dir-name>",
         "RT_DEV_TOOLS_TELEMETRY_HOST_ROOT": "<absolute path to the project root>",
         "RT_DEV_TOOLS_TELEMETRY_LOOPBACK_BASE": "http://wordpress"
       }
     } } }
     ```
     `wp-env` replaces `plugins` wholesale — if the file already has entries, list those too, not just the two above.
   - **Anything else** (Local by Flywheel, VIP dev-env, a bare server): no override file — define the same six as constants in `wp-config.php`, and install both plugins the way you normally would.
3. `.gitignore` — add `/.wp-env.override.json` (wp-env only; skip if step 2 used `wp-config.php`).
4. `package.json` `scripts` — add `dev:connect`/`dev:disconnect` (§The commands).

Show each as a diff, get consent, apply only on approval. Composer update (`composer update rtcamp/wp-dev-tools -W` — update, not install, the lock has no entry yet) and starting the local environment are developer actions, never run by the skill.

### 3. Connect

`npm run dev:connect` (STDIO), or the HTTP + Application Password path if the client can't use STDIO. Confirm `/mcp` shows the `wp-dev-tools` server before calling this done.

### 4. Verify

If `bin/dev-tools-e2e.sh` exists, run it (`--url=` for a non-default site): exit `0` is a clean pass, `1` means report which check(s) failed verbatim — that's the troubleshooting entry point (§5) — and `2` means a prerequisite is missing, fix the environment, not the code. Otherwise run the same checks by hand: abilities registered (`wp_get_abilities()` filtered to `wp-dev-tools/`), `tools/list` shows the full allow-list, capture loop works (visit → `list-requests` → `get-telemetry` → `compare-requests`). Either way, report each check's pass/fail — never a silent retry.

### 5. Troubleshoot

| Symptom | Cause | Fix |
|---|---|---|
| `/mcp` shows nothing | `dev:connect` never run, or wrong command | Re-run `dev:connect`; check it matches §The commands. |
| Abilities missing from `tools/list` | MCP Adapter inactive, or `RT_DEV_TOOLS_DEV_MODE` isn't `true` | Activate the Adapter; check the config (`.wp-env.override.json`, or `wp-config.php` on a non-wp-env setup). |
| Registered but calls fail/time out | Wrong `WP_ENVIRONMENT_TYPE`, or the local environment isn't running | Fix the config; start the environment (`npx wp-env start` or equivalent). |
| Capture loop returns nothing | Query Monitor inactive, or `SAVEQUERIES` unset | Activate QM; set `SAVEQUERIES` in the config. |
| HTTP path fails auth | Application Password missing/expired, wrong header | Regenerate the password; check the header. |

Same fix failing three times: stop, report what you tried, ask before continuing.

## Hard rules — never violate

- Never run a package manager, or apply a file edit, without explicit consent.
- Never commit, push, or open a PR without consent.
- Never report a check as passed without actually running it.

## Reference

- Init engine feature: `bin/features/dev-tools.js`, wired into `bin/scaffold.config.js` — reference consumer, `features-plugin-skeleton`. Canonical source for the exact constraint / plugin pins / override shape in §2.
- E2E checklist: `docs/dev-tools-e2e.md` + `bin/dev-tools-e2e.sh` — same reference consumer.
- Companion skills: `setup`, `scaffold`.

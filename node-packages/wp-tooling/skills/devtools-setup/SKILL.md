---
name: devtools-setup
description: Get wp-devtools connected on a project — check prerequisites, enable it, connect the MCP client, verify the loop, and troubleshoot when broken. Works even if the project never ran the init engine. Use when the developer mentions dev-tools, wp-devtools, MCP, `/mcp`, Query Monitor, the MCP Adapter, `dev:connect`, or asks to set up, connect, verify, or fix the dev-tools integration.
---

# devtools-setup

Check → enable → connect → verify → troubleshoot: gets wp-devtools working on a project end to end, or finds out why it isn't.

## Use for

- Connecting wp-devtools on a project, whether or not it used the init engine.
- Diagnosing a broken or incomplete connection, or re-verifying after an environment change.

## Do not use for

- General plugin/theme scaffolding (`setup`) or one-off feature scaffolds (`scaffold`).
- Audits (a11y/perf/security) once dev-tools is already connected — separate lens skills.

## The commands

| Command | Does |
|---|---|
| `npm run init -- --enable=dev-tools` | Manage-mode toggle (needs `.wp-scaffold.json`). Wires `composer.json` require-dev + VCS entry, `.wp-env.json` keys (Query Monitor, MCP Adapter, `WP_ENVIRONMENT_TYPE`, `SAVEQUERIES`, enablement knob, `CONTAINER_ROOT`/`HOST_ROOT`, `LOOPBACK_BASE`), and `dev:connect`. Confirms before writing unless `-y`. |
| `npm run dev:connect` | `claude mcp add wp-devtools -- npx wp-env run cli -- wp mcp-adapter serve --server=wp-devtools --user=admin` (STDIO; no `.mcp.json`). |
| `/mcp` | Confirms the server is connected. |
| `bash bin/dev-tools-e2e.sh` (if present) | The reference consumer's verify smoke — boot+gate, abilities, MCP route, `tools/list` allow-list, capture loop, CWV beacon, adapter isolation. Exit `0`/`1`/`2` = pass/fail/prerequisite-missing. Not every project has this script — see §4 for the manual equivalent. |

## Workflow

Track the 5 steps below as a TODO list, one `in_progress` at a time.

### 1. Check (Preflight)

WordPress ≥ 6.9 (`wp core version`); PHP version against wp-devtools' `composer.json` constraint; Query Monitor + MCP Adapter available; local env is `wp-env` or `vip dev-env`; whether `.wp-scaffold.json` exists (picks the branch below); the enablement knob (decision B3); an MCP client to connect to. Report every gap with its exact fix — print install commands, don't run them.

### 2. Install / enable

| Project state | Action |
|---|---|
| `.wp-scaffold.json` exists | `npm run init -- --enable=dev-tools` (manage mode). Never `--features=` — it sets the exact enabled set and would disable other defaults (e.g. `hmr`). Revert with `--disable=dev-tools`. |
| wp-tooling present, never initialized | Don't run `npm run init` yourself — first run is a full scaffold wizard (project identity, capabilities), not a toggle. Ask the developer to run it once, then retry. |
| No init engine | Wire by hand: `composer.json` require-dev + VCS entry, `.wp-env.json` keys (§The commands), `dev:connect` script. Diff + consent per edit. |

Composer/npm installs are always a developer action.

### 3. Connect

`npm run dev:connect` (STDIO), or the HTTP + Application Password path if the client can't use STDIO. Confirm `/mcp` shows the server before calling this done.

### 4. Verify

If `bin/dev-tools-e2e.sh` exists, run it (`--url=` for a non-default site): exit `0` is a clean pass, `1` means report which check(s) failed verbatim — that's the troubleshooting entry point (§5) — and `2` means a prerequisite is missing, fix the environment, not the code. Otherwise run the same checks by hand: abilities registered (`wp_get_abilities()` filtered to `wp-devtools/`), `tools/list` shows the full allow-list, capture loop works (visit → `list-requests` → `get-telemetry` → `compare-requests`). Either way, report each check's pass/fail — never a silent retry.

### 5. Troubleshoot

| Symptom | Cause | Fix |
|---|---|---|
| `/mcp` shows nothing | `dev:connect` never run, or wrong command | Re-run `dev:connect`; check it matches §The commands. |
| Abilities missing from `tools/list` | MCP Adapter inactive, or the enablement knob is off | Activate the Adapter; check the knob (B3). |
| Registered but calls fail/time out | Wrong `WP_ENVIRONMENT_TYPE`, or `wp-env` not running | Fix `.wp-env.json`; `npx wp-env start`. |
| Capture loop returns nothing | Query Monitor inactive, or `SAVEQUERIES` unset | Activate QM; set `SAVEQUERIES`. |
| HTTP path fails auth | Application Password missing/expired, wrong header | Regenerate the password; check the header. |

Same fix failing three times: stop, report what you tried, ask before continuing.

## Hard rules — never violate

- Never run a package manager, or apply a file edit, without explicit consent.
- Never commit, push, or open a PR without consent.
- Never report a check as passed without actually running it.

## Reference

- Init engine feature: `bin/features/dev-tools.js`, wired into `bin/scaffold.config.js` — reference consumer, `features-plugin-skeleton`.
- E2E checklist: `docs/dev-tools-e2e.md` + `bin/dev-tools-e2e.sh` — same reference consumer.
- Companion skills: `setup`, `scaffold`.

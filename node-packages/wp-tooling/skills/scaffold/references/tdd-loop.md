# TDD Loop

Use this file when you're executing the TDD loop for a scaffolded artifact (§7 of the workflow). Run it exactly - red first, one test at a time to green.

| Step | Action |
|---|---|
| A | Expand the engine's stub into the full suite from §4's checklist. Strip every `markTestIncomplete`. |
| B | Run: `composer test` / `composer test:unit` (PHP), `npm run test:js` / `npx jest` (JS). Expect red. If the runner errors before running, invoke the relevant `setup/*` scaffold and retry. |
| C | Implement just enough production code to flip **one** failing test green. |
| D | Re-run. Confirm that one test passes. |
| E | Loop B-D one test at a time. |
| F | Once green, refactor; re-run. |
| G | Final gates - all must pass: full PHPUnit suite, full Jest suite if JS touched, `composer lint:php`, `npm run lint:js`. |

Frameworks per kind:

| Kind | Framework |
|---|---|
| `wp/cpt`, `wp/taxonomy`, `wp/cron`, `wp/cli`, `wp/rest`, `wp/shortcode`, `wp/admin-page`, `wp/settings-page`, `wp/user-role`, `wp/registrable` | PHPUnit |
| `wp/block-dynamic` | Jest (edit.js) + PHPUnit (render method) |
| `block/interactive` | Jest + Playwright |
| `ci/*` | actionlint + yaml-parse |

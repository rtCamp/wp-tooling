# TDD Loop

| Step | Action |
|---|---|
| A | Expand the engine's stub into the full suite from the §4 checklist. Strip every `markTestIncomplete`. |
| B | Run the test suite. Expect red. If the runner errors before running, invoke the relevant `setup/*` scaffold and retry. |
| C | Implement just enough production code to flip **one** failing test green. |
| D | Re-run. Confirm that one test passes. |
| E | Loop B–D one test at a time. |
| F | Once green, refactor; re-run. |
| G | Final gates — all must pass: full test suite, `composer lint:php`, `npm run lint:js` if JS touched. |

## Test runner by kind

| Kind | Framework | Run command |
|---|---|---|
| `wp/cpt`, `wp/taxonomy`, `wp/cron`, `wp/cli`, `wp/rest`, `wp/shortcode`, `wp/admin-page`, `wp/settings-page`, `wp/user-role`, `wp/registrable` | PHPUnit | `composer test` or `composer test:unit` |
| `wp/block-dynamic` | Jest (edit.js) + PHPUnit (render method) | `npm run test:js` / `npx jest` + `composer test` |
| `block/interactive` | Jest + Playwright | — |
| `ci/*` | actionlint + yaml-parse | — |

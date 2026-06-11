# Phase B — Feature Scaffold Mapping

Map each feature the developer mentioned to a scaffold ID. Run `npx wp-tooling list --json` to confirm what is available.

| Developer said | Scaffold ID |
|---|---|
| CLI command | `wp/cli` |
| REST endpoint / API | `wp/rest` |
| Cron job / background job | `wp/cron` |
| Gutenberg block | `wp/block-dynamic` |
| Cache / transients | `utility/cache` |
| CI pipeline | `ci/cd-wporg` (or other CI scaffold) |

If a feature has no matching scaffold, note it explicitly as a manual task in the final report.

## Execution

For each feature scaffold, pass project conventions detected in Stage 1 (namespace, base path, class suffix). Defaults assume the rtCamp skeleton (`Inc\Cli`, `includes/Cli`) — wrong for any other project.

Example for `wp/cli`:
```bash
npx wp-tooling add wp/cli \
    --non-interactive --json --cwd . \
    --namespace='Acme\Plugin\Cli' --base-path='includes/Cli' \
    --name=optimize-images --class=OptimizeImagesCommand
```

The engine emits `ai.wiring` (registration point) and a thin test stub. Show wiring, get consent, apply. Then expand the stub into a full test suite and implement test-by-test until green. Do not batch feature scaffolds — one at a time, complete its TDD loop, then move to the next.

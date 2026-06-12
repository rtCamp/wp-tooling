# Phase B — Feature Scaffold Mapping

Use this file when you're mapping requested features to scaffold IDs (§2 of the workflow) or invoking a feature scaffold (§5).

Map each feature the developer mentioned to one or more scaffold IDs from the catalogue:

| Developer said | Scaffold ID |
|---|---|
| CLI command | `wp/cli` |
| REST endpoint / API | `wp/rest` (if available) |
| Cron job / background job | `wp/cron` (if available) |
| Gutenberg block | `wp/block-dynamic` |
| Cache / transients | `utility/cache` |
| CI pipeline | `ci/cd-wporg` (or other CI scaffold) |

Run `npx wp-tooling list --json` to see exactly what is available. If a feature the developer wants has no matching scaffold, note it explicitly as a manual task in the final report.

## Execution

For `wp/cli`, pass the same project conventions detected in Stage 1 (namespace, base path, class suffix) — defaults assume the rtCamp skeleton (`Inc\Cli`, `includes/Cli`) and will be wrong for any other project:

```bash
npx wp-tooling add wp/cli \
    --non-interactive --json --cwd . \
    --namespace='Acme\ImageOptimizer\Cli' --base-path='includes/Cli' \
    --name=optimize-images --class=OptimizeImagesCommand
```

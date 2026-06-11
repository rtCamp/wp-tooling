# Engine Error Codes

| Code | Response |
|---|---|
| `ENOSCAFFOLD` | Surface `available` list, suggest closest, ask. |
| `EMISSINGINPUT` | Read `missingDetails`, run §2 discovery, retry with resolved values. |
| `EBADSCAFFOLD` | Invalid manifest. Surface verbatim, do not retry. For `origin: "remote"` this means the fetched manifest is broken — surface it, do not repair another repo's scaffold. |
| `EWRITEFAIL` | Surface path + errno. Do not retry. |
| `ERENDERFAIL` | Scaffold author bug. Surface verbatim. |
| `EFETCHFAIL` | Network/HTTP failure. Surface `url` + `statusCode`. If `rateLimited`, tell developer to set `WP_TOOLING_GITHUB_TOKEN` and stop. Timeout is transient — one retry is reasonable; 404 means the source pin (`sources.json` repo/ref/path) is wrong — surface, do not retry. Never hand-write the artifact to work around a failed fetch. |
| Unknown | Surface verbatim, exit non-zero, do not crash. |

## CI/CD variant

- `ai.wiring` usually empty.
- `developer.secrets` usually populated. For multi-workflow setups, emit one consolidated `gh secret set` checklist at the end (dedupe).
- `ai.tests` framework is `actionlint` or `yaml-parse`. Validate; do not fill the YAML.

## Reference docs

- Engine contract: `node_modules/@rtcamp/wp-tooling/docs/ai-orchestration.md`
- Examples: `node_modules/@rtcamp/wp-tooling/docs/examples.md`
- Engine source: `node_modules/@rtcamp/wp-tooling/src/scaffolds/`
- Test templates: `scaffolds/wp/<kind>/templates/test.php.mustache`

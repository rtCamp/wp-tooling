# Engine Error Codes

Use this file when an `npx wp-tooling` command exits non-zero.

| Code | Response |
|---|---|
| `ENOSCAFFOLD` | Surface `available` list, suggest closest, ask. |
| `EMISSINGINPUT` | Read `missingDetails`, run §2 discovery, retry with resolved values. |
| `EBADSCAFFOLD` | Invalid manifest. Surface verbatim, do not retry. For an `origin: "remote"` scaffold this means the fetched manifest at its pinned ref is broken — surface it; do not try to repair another repo's scaffold. |
| `EWRITEFAIL` | Surface path + errno. Do not retry. |
| `ERENDERFAIL` | Scaffold author bug. Surface. |
| `EFETCHFAIL` | Network/HTTP failure fetching an `origin: "remote"` scaffold's manifest or a template. Surface `url` + `statusCode`. If the payload sets `rateLimited`, tell the developer to set `WP_TOOLING_GITHUB_TOKEN` and stop. A timeout is transient — one retry is reasonable; a 404 means the source pin (`sources.json` repo/ref/path) or the owning repo's index is wrong — surface, do not retry. Never hand-write the artifact to work around a failed fetch (the engine owns it). |
| Unknown | Surface, exit non-zero, do not crash. |

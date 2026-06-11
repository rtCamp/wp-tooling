# Integration Test Checklist by Kind

When deriving test cases (§4 of the workflow), include these integration assertions per kind — on top of happy path, edge cases, and error paths.

| Kind | Required integration assertions |
|---|---|
| `wp/cpt` | `post_type_exists()`, supports, REST exposure, attached taxonomies |
| `wp/taxonomy` | `taxonomy_exists()`, attached object types, term assignment |
| `wp/rest` | Route in `rest_get_server()->get_routes()`, permission check, request/response schema, dedupe behaviour |
| `wp/block-dynamic` | Block name, `register_hooks` action, `render()` markup with `WP_Query` fixture, empty state, count cap, attribute filters |
| `wp/cron` | `wp_next_scheduled()`, callback fires, unschedule works |
| `wp/cli` | `WP_CLI::add_command` registered, `__invoke` behaviour, dry-run flag |

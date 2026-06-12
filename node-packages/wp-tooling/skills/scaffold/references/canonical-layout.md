# Canonical Layout

Use this file when you're resolving where a scaffolded artifact and its tests live (§3 of the workflow).

Files group by **kind**, never by feature. `<Root>` = project's autoload root (e.g. `Inc`, `Acme\Blog`). Honour these unless the project shows ≥3 consistent samples justifying a deviation.

| Scaffold | Source dir | Source ns | Test dir | Test ns | Module |
|---|---|---|---|---|---|
| `wp/cpt` | `includes/PostTypes/` | `<Root>\PostTypes` | `tests/PostTypes/` | `<Root>\Tests\PostTypes` | `<Root>\Modules\PostTypes` |
| `wp/taxonomy` | `includes/Taxonomies/` | `<Root>\Taxonomies` | `tests/Taxonomies/` | `<Root>\Tests\Taxonomies` | `<Root>\Modules\Taxonomies` |
| `wp/block-dynamic` | `includes/Blocks/` + `src/blocks/<slug>/` + `build/blocks/<slug>/` | `<Root>\Blocks` | `tests/Blocks/` | `<Root>\Tests\Blocks` | `<Root>\Modules\Blocks` |
| `wp/rest` | `includes/Rest/` | `<Root>\Rest` | `tests/Rest/` | `<Root>\Tests\Rest` | `<Root>\Modules\Rest` |
| `wp/shortcode` | `includes/Shortcodes/` | `<Root>\Shortcodes` | `tests/Shortcodes/` | `<Root>\Tests\Shortcodes` | `<Root>\Modules\Shortcodes` |
| `wp/admin-page` | `includes/Admin/` | `<Root>\Admin` | `tests/Admin/` | `<Root>\Tests\Admin` | `<Root>\Modules\Admin` |
| `wp/settings-page` | `includes/Settings/` | `<Root>\Settings` | `tests/Settings/` | `<Root>\Tests\Settings` | `<Root>\Modules\Settings` |
| `wp/user-role` | `includes/Roles/` | `<Root>\Roles` | `tests/Roles/` | `<Root>\Tests\Roles` | `<Root>\Modules\Roles` |
| `wp/cli` | `includes/Cli/` | `<Root>\Cli` | `tests/Cli/` | `<Root>\Tests\Cli` | `<Root>\Modules\Cli` |
| `wp/cron` | `includes/Cron/` | `<Root>\Cron` | `tests/Cron/` | `<Root>\Tests\Cron` | `<Root>\Modules\Cron` |
| `wp/registrable` | `includes/Services/` | `<Root>\Services` | `tests/Services/` | `<Root>\Tests\Services` | `<Root>\Modules\Services` |

**Modules host one kind each. No `Modules/<Feature>/...`.** A multi-kind feature (e.g. Testimonials = CPT + taxonomy + block + REST) spans the per-kind directories and wires into each kind's module.

If the project already has a per-feature module folder, flag as anti-pattern. Offer migration before adding new artifacts. Do not scaffold into it.

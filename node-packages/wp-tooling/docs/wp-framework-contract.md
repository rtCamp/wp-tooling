# wp-framework contract

The scaffolds under `scaffolds/wp/` and `scaffolds/block/` in `@rtcamp/wp-tooling` generate PHP code that extends abstract base classes shipped by `rtcamp/wp-framework`. This document specifies the class surface those scaffolds expect.

If you are working in `wp-framework`, treat this as the requirements list. If you are authoring a new `wp/...` or `block/...` scaffold here, treat it as the available API.

The framework was previously published as `rtcamp/wp-php-toolkit` and renamed before its 1.0 release. References to the old name should be considered historical.

---

## Composer coordinates

```
"require": {
    "rtcamp/wp-framework": "^1.0"
}
```

Namespace root: `rtCamp\WPFramework`.

---

## Composition model

Every scaffold-generated class is wired into the framework through one of two paths.

1. **Abstract subclass** that implements `Registrable` implicitly via the abstract's `register_hooks()`. The consumer's plugin groups instances in an `AbstractModule` subclass; the framework's `Loader` trait instantiates them and calls `register_hooks()` on each.

2. **Plain `Registrable` implementer** (the `wp/registrable` escape hatch). Same wiring path as above; the class declares its own hooks in `register_hooks()`.

The `Loader` also recognises `ConditionallyRegistrable` (skip when `can_register()` is false) and `Shareable` (cache the instance in `Container`).

---

## Abstract classes the scaffolds target

All paths below sit under `rtCamp\WPFramework\Contracts\Abstracts\`.

### `AbstractPostType` (extended by `scaffolds/wp/cpt`)

Required overrides:

- `public static get_slug(): string`
- `public get_singular_label(): string`
- `public get_plural_label(): string`
- `public get_menu_icon(): string`

Common optional overrides surfaced in the scaffold:

- `get_editor_supports(): array`
- `get_supported_taxonomies(): array`
- `is_hierarchical(): bool`
- `get_menu_position(): ?int`
- `get_labels(): array`
- `get_custom_options(): array`

Wiring: `register_hooks()` attaches `register()` to the `init` action.

### `AbstractTaxonomy` (extended by `scaffolds/wp/taxonomy`)

Required overrides:

- `public static get_slug(): string`
- `public static get_object_types(): array`
- `public get_singular_label(): string`
- `public get_plural_label(): string`

Common optional overrides: `is_hierarchical()`, `get_labels()`, `get_custom_options()`.

Wiring: `register_hooks()` attaches `register()` to `init`.

### `AbstractBlock` (extended by `scaffolds/wp/block-dynamic`)

Required overrides:

- `public static get_name(): string`
- `public render( array $attributes, string $content, \WP_Block $block ): string`

Common optional overrides: `get_block_dir(): ?string`, `get_block_args(): array`.

Wiring: `register_hooks()` attaches block registration to `init`.

Not for every block: `AbstractBlock::register_block()` forces
`$args['render_callback']`, which overrides a `"render": "file:./render.php"`
declared in `block.json`. A block that renders from a PHP template instead of a
class method therefore implements `Registrable` directly and calls
`register_block_type()` on its build directory — that is what
`scaffolds/wp/block-interactive` does.

### `AbstractShortcode` (extended by `scaffolds/wp/shortcode`)

Required overrides:

- `public static get_tag(): string`
- `public render( array $atts, ?string $content ): string`

Common optional override: `default_atts(): array`.

Wiring: `register_hooks()` registers via `add_shortcode()` on `init`.

### `AbstractAdminPage` (extended by `scaffolds/wp/admin-page`)

Required overrides:

- `public static get_slug(): string`
- `public get_page_title(): string`
- `public get_menu_title(): string`
- `public render(): void`

Common optional overrides: `get_parent_slug()`, `get_capability()`, `get_icon()`, `get_position()`.

Wiring: `register_hooks()` attaches `register_page()` to `admin_menu`.

### `AbstractSettingsPage` (extended by `scaffolds/wp/settings-page`)

Required overrides:

- `public static get_slug(): string`
- `public get_page_title(): string`
- `public get_menu_title(): string`
- `public get_settings(): array`
- `public render(): void`

Common optional overrides: `get_option_group()`, `get_parent_slug()`, `get_capability()`.

Wiring: `register_hooks()` attaches the menu to `admin_menu`, settings to `admin_init` and `rest_api_init`.

### `AbstractUserRole` (extended by `scaffolds/wp/user-role`)

Required overrides:

- `public static get_slug(): string`
- `public get_display_name(): string`
- `public get_capabilities(): array`
- `public get_version(): int`

Wiring: `register_hooks()` attaches `maybe_update_role()` to `admin_init`. The role re-registers only when `get_version()` is higher than the stored version.

### `AbstractRESTController` (extended by `scaffolds/wp/rest`)

Extends `WP_REST_Controller`.

Required: `public register_routes(): void`.

Properties: `protected string $namespace` and `protected string $version`.

Wiring: `register_hooks()` attaches `register_routes()` to `rest_api_init`.

### `AbstractModule` (extended by `scaffolds/wp/module`)

Required: `public get_classes(): array` returning a list of class strings.

Wiring: the framework's `Loader` instantiates each listed class and calls `register_hooks()` if it implements `Registrable`.

---

## Interfaces

All paths below sit under `rtCamp\WPFramework\Contracts\Interfaces\`.

### `Registrable` (implemented by `scaffolds/wp/cron`, `scaffolds/wp/registrable`)

```php
interface Registrable {
    public function register_hooks(): void;
}
```

### `ConditionallyRegistrable`

```php
interface ConditionallyRegistrable extends Registrable {
    public function can_register(): bool;
}
```

### `Shareable`

Marker interface (no methods). The Loader caches the instance in `Container`.

### `CLICommand` (implemented by `scaffolds/wp/cli`)

```php
interface CLICommand {
    public static function get_name(): string;
    public static function get_description(): string;
    public static function run( array $args, array $assoc_args ): void;
}
```

---

## Optional helpers (not currently scaffolded)

- `AssetLoaderTrait`: register scripts, styles, block manifests with versioning from a build's `.asset.php` file.
- `TemplateLoaderTrait`: child-theme > parent-theme > plugin template lookup with filterable search paths.
- `AutoloaderTrait`: boots the Composer autoloader with a graceful admin notice on failure.
- `Encryptor`: final concrete class. AES-256-GCM helper for sensitive options.

---

## Anchor convention

Every scaffold that produces a class registers via the consumer's `AbstractModule` subclass. The module file contains a marker comment inside `get_classes()`; the scaffold's `wiring` block inserts the new class string immediately above the marker.

Marker pattern: `// scaffold:<scaffold-id>:classes`. Examples:

- `// scaffold:wp/cpt:classes` inside `Modules/PostTypes.php`
- `// scaffold:wp/taxonomy:classes` inside `Modules/Taxonomies.php`
- `// scaffold:wp/block-dynamic:classes` inside `Modules/Blocks.php`
- `// scaffold:wp/registrable:classes` inside `Modules/Services.php`

Each `Modules/<Name>.php` file is itself produced by the `wp/module` scaffold, which accepts a `kind` input that selects which anchor to emit.

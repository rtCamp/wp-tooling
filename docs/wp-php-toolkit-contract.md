# wp-php-toolkit framework contract

The `@rtcamp/wp-tooling` scaffolds in `scaffolds/wp/` generate PHP code that extends abstract base classes shipped by `rtcamp/wp-php-toolkit`. This document specifies the class surface those scaffolds expect.

If you are working in `wp-php-toolkit`, treat this as the requirements list. If you are authoring a new `wp/...` scaffold here, treat it as the available API.

---

## Trait: `RtCamp\WPToolkit\Traits\Singleton`

A standard singleton trait used by the optional `--singleton=true` mode of `wp/cli` and the default mode of `wp/rest`.

**Contract:**

- Provides `public static function get_instance(): static`.
- Hides the constructor (typically `protected function __construct()`).
- On first `get_instance()`, calls `static::setup(): void` once for hook wiring or initialisation.
- Uses late static binding (`static::`, never `self::`) for subclass support.

**Example skeleton:**

```php
namespace RtCamp\WPToolkit\Traits;

trait Singleton {
    private static array $instances = [];

    public static function get_instance(): static {
        $class = static::class;
        if ( ! isset( self::$instances[ $class ] ) ) {
            self::$instances[ $class ] = new static();
            self::$instances[ $class ]->setup();
        }
        return self::$instances[ $class ];
    }

    protected function __construct() {}
}
```

Consuming classes must declare `public function setup(): void;` (even if empty).

---

## Abstract: `RtCamp\WPToolkit\Abstracts\Abstract_REST_Controller`

Base for REST API controllers. Used by `wp/rest`.

**Contract:**

- Property `protected string $rest_namespace` — REST namespace, e.g. `myplugin/v1`.
- Property `protected string $rest_base` — route segment, e.g. `images`.
- Abstract method `abstract public function register_routes(): void;` — called on `rest_api_init`.
- Hooks `register_routes` to `rest_api_init` automatically (in `setup()` for the singleton variant, in `register()` for the multi-instance variant).
- Provides `public function register(): void` for the multi-instance path (binds the hook and returns `$this` for chaining).

---

## Abstract: `RtCamp\WPToolkit\Abstracts\Abstract_Post_Type`

Base for Custom Post Types. Used by `wp/cpt`. Always multi-instance.

**Contract:**

- Property `protected string $slug` — the post type slug passed to `register_post_type()`.
- Abstract method `abstract protected function get_args(): array;` — returns the `$args` array for `register_post_type()`.
- Method `public function register(): self` — binds the `init` hook that calls `register_post_type( $this->slug, $this->get_args() )`.
- Default text domain in labels is the consumer's responsibility; the scaffold uses `'text-domain'` as a placeholder.

---

## Abstract: `RtCamp\WPToolkit\Abstracts\Abstract_Taxonomy`

Base for Taxonomies. Used by `wp/taxonomy`. Always multi-instance.

**Contract:**

- Property `protected string $slug` — taxonomy slug passed to `register_taxonomy()`.
- Abstract method `abstract protected function get_object_types(): array;` — returns the post type slugs the taxonomy attaches to.
- Abstract method `abstract protected function get_args(): array;` — returns the `$args` array for `register_taxonomy()`.
- Method `public function register(): self` — binds the `init` hook that calls `register_taxonomy( $this->slug, $this->get_object_types(), $this->get_args() )`.

---

## Abstract: `RtCamp\WPToolkit\Abstracts\Abstract_Cron_Job`

Base for scheduled jobs. Used by `wp/cron`. Always multi-instance.

**Contract:**

- Property `protected string $hook` — the WordPress action hook name.
- Property `protected string $recurrence` — one of `hourly`, `twicedaily`, `daily`, `weekly`, or a custom schedule key registered via `cron_schedules`.
- Abstract method `abstract public function run(): void;` — the body of the job.
- Method `public function register(): self`:
  - Binds `run()` to `$this->hook`.
  - Calls `wp_schedule_event( time(), $this->recurrence, $this->hook )` if not already scheduled.
  - Returns `$this` for chaining.
- Method `public function unschedule(): void` — clears any scheduled events for `$this->hook`. Called during plugin deactivation.

---

## Adding more abstracts

When a new `wp/...` scaffold needs a new abstract from `wp-php-toolkit`:

1. Add a section to this document specifying the contract (properties, abstract methods, behaviour).
2. Open an issue on `wp-php-toolkit` referencing this contract.
3. Ship the scaffold here. Mark the scaffold's `description` with `Requires rtcamp/wp-php-toolkit ^X.Y` if it depends on an unreleased version.

Scaffolds and their abstracts must ship together (same minor version of `wp-php-toolkit`). Do not ship a scaffold against a class that does not yet exist in a released version — it will break for any consumer that runs `composer install` before the toolkit release.

---

## Notes for the toolkit author

- Every abstract should be `final` only at the leaf; intermediate abstracts must remain extensible.
- Constructors on multi-instance abstracts should accept their core configuration as typed constructor parameters where it makes sense (e.g. `public function __construct( string $slug, array $args = [] )`), but the scaffolded subclasses in this repo currently override property defaults instead. Either pattern works; the scaffold templates assume the property-override pattern for readability.
- All public methods must have full type declarations (matches the toolkit's non-negotiable rule).
- Hook wiring inside `setup()` / `register()` must be idempotent — calling twice should not double-register.

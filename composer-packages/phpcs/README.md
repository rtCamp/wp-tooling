# rtCamp WordPress PHPCS standards (`rtcamp/wp-phpcs`)

Shared PHP_CodeSniffer standards for rtCamp WordPress projects. Each skeleton (plugin, theme,
and future tracks) extends one of these instead of copying — and drifting — a long PHPCS
config. The rules curate and combine:

- [WordPress Coding Standards](https://github.com/WordPress/WordPress-Coding-Standards) (WPCS)
- [Automattic VIP Coding Standards](https://github.com/Automattic/VIP-Coding-Standards)
- [PHPCompatibility](https://github.com/PHPCompatibility/PHPCompatibilityWP)
- [Slevomat Coding Standard](https://github.com/slevomat/coding-standard) (strict tier only)

> These are **WordPress** standards. The base sniffs (WPCS, VIP) assume a WordPress codebase
> and will be noisy on non-WordPress PHP — use a framework-agnostic standard for that.

## Standards

| Standard | What it is | Use when |
| --- | --- | --- |
| **`RTCampWP`** | The full strict superset: everything in `RTCampWP-Basic` **plus** short-array enforcement and the Slevomat strict-typing, code-quality and doc-block sniffs (`declare(strict_types=1)`, mandatory parameter/property/return type hints, etc.). | New or public projects ready to adopt strict types. **Default for greenfield work.** |
| **`RTCampWP-Basic`** | WPCS (`WordPress-Extra`) + `WordPress-VIP-Go` + `WordPress-Docs` + `PHPCompatibilityWP`, with modern idioms (`[]`, `?:`) allowed and one-blank-line function spacing. No strict-typing requirements. | Adopting standards on an existing codebase, or when strict types are not yet practical. |

`RTCampWP` is `RTCampWP-Basic` plus the strict layer, so the two never diverge — there is a
single source of truth.

## Installation

```bash
composer require --dev rtcamp/wp-phpcs
```

This pulls in PHPCS and every external sniff (WPCS, VIPCS, PHPCompatibilityWP, Slevomat), so
you do not list them yourself. The
[PHP_CodeSniffer Standards Composer Installer](https://github.com/PHPCSStandards/composer-installer)
registers the standards automatically — just allow the plugin in your `composer.json`:

```json
{
    "config": {
        "allow-plugins": {
            "dealerdirect/phpcodesniffer-composer-installer": true
        }
    }
}
```

Confirm they registered with `vendor/bin/phpcs -i` — you should see `RTCampWP` and
`RTCampWP-Basic` in the list.

## Usage

Add a `phpcs.xml.dist` at your project root that references the standard and supplies the
**project-specific** configuration the shared standard deliberately leaves out — the files to
scan, `testVersion`, `minimum_wp_version`, global prefixes, text domain, and file-naming mode:

```xml
<?xml version="1.0"?>
<ruleset name="My Project">
    <file>./includes/</file>
    <file>./tests/</file>

    <config name="testVersion" value="8.2-" />
    <config name="minimum_wp_version" value="6.5" />

    <rule ref="RTCampWP" />

    <rule ref="WordPress.NamingConventions.PrefixAllGlobals">
        <properties>
            <property name="prefixes" type="array">
                <element value="my_project" />
            </property>
        </properties>
    </rule>
    <rule ref="WordPress.WP.I18n">
        <properties>
            <property name="text_domain" type="array">
                <element value="my-project" />
            </property>
        </properties>
    </rule>
</ruleset>
```

A complete, commented starting point is in
[`phpcs.xml.dist.example`](./phpcs.xml.dist.example) — copy it to your project root, rename it
to `phpcs.xml.dist`, and adjust the values.

### Overriding rules

Both standards are a starting point. Exclude or down-tune any sniff in your own
`phpcs.xml.dist`:

```xml
<rule ref="RTCampWP">
    <exclude name="SlevomatCodingStandard.TypeHints.DeclareStrictTypes" />
</rule>
```

## What stays in your project config (not the shared standard)

`testVersion`, `minimum_wp_version`, `WordPress.WP.I18n` text domain,
`WordPress.NamingConventions.PrefixAllGlobals` prefixes, `WordPress.Files.FileName`
(`is_theme` vs PSR-4), the `<file>` paths to scan, and per-path test excludes — these are
project-specific and live in your `phpcs.xml.dist`, never here.

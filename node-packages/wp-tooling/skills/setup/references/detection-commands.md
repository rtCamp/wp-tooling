# Detection Commands

Use this file when you're detecting what already exists in the project before building the scaffold plan (§1 of the workflow).

**Project type:**
```bash
grep -rl "Plugin Name:\|Theme Name:" . --include="*.php" --exclude-dir=vendor --exclude-dir=node_modules -l | head -1
```

**VIP indicators:**
```bash
grep -rl "WordPress-VIP-Minimum\|automattic/vip-coding-standards\|VIP_GO_ENV" . \
    --include="*.{php,xml,json,yml}" --exclude-dir=vendor --exclude-dir=node_modules | head -3
```

**Languages present:**
```bash
find . -name "*.php" -not -path "*/vendor/*" | head -1
find . \( -name "*.js" -o -name "*.jsx" \) -not -path "*/node_modules/*" -not -path "*/build/*" | head -1
find . \( -name "*.scss" -o -name "*.css" \) -not -path "*/node_modules/*" | head -1
```

**PSR-4 autoload:**
```bash
grep -A 8 '"autoload"' composer.json 2>/dev/null
```

**Existing tooling configs (skip scaffold if present):**
```bash
ls .editorconfig phpcs.xml.dist phpstan.neon.dist eslint.config.js .stylelintrc.js \
   phpunit.xml.dist jest.config.js .pa11yci.json 2>/dev/null
```

**Existing namespace (if PSR-4 missing):**
```bash
grep -r "^namespace " . --include="*.php" --exclude-dir=vendor | head -3
```

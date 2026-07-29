# Editor Setup — VSCode

This repo ships a committed VSCode configuration that any engineer can pick up as-is.

---

## Verified-publisher policy

`.vscode/extensions.json` contains **only extensions published by verified organisations** — Microsoft, GitHub, Red Hat, EditorConfig Foundation. No individual publishers, no "community" extensions, regardless of popularity.

**Why:** VSCode extensions run with full filesystem and network access by default. A supply-chain compromise in a popular individual-published extension has happened before and will happen again. Sticking to verified organisations keeps our attack surface small.

---

## JS / Jest — no extension trust needed

JavaScript IntelliSense is built into VSCode (no extension). ESLint is handled by the Microsoft-maintained ESLint extension. Jest runs as a task.

### Running the tasks

Open the command palette (`Cmd+Shift+P`):

- **Tasks: Run Task** — pick from the full list
- **Tasks: Run Build Task** (`Cmd+Shift+B`) — runs "Check everything" (lint + tests)
- **Tasks: Run Test Task** — runs "JS: Run tests (Jest)"

### What you'll see

- ESLint errors appear inline (squiggle underlines) + in the Problems panel — handled by the official ESLint extension
- Jest failures print to the terminal with full stack traces
- `npm test -- --watch` gives you live feedback without opening a separate terminal — use the "JS: Test watch (Jest)" task

---

## Personal settings

If you want to override any workspace setting on your machine, create `.vscode/settings.local.json` — gitignored by default. VSCode merges it on top of `settings.json`.

---

## If an extension goes unmaintained or changes publisher

If a currently-recommended extension is sold, donated, or transferred to a different publisher — especially if the new publisher is unverified — flag it in the repo. We'd rather lose a feature than run a hijacked extension.

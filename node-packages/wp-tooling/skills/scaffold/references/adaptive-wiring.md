# Adaptive Wiring

The engine emits `ai.wiring` entries telling you where a scaffolded artifact must be registered. Each is `{ targetFile, anchor, snippet, description }`. Wiring is *adaptive* because the canonical snippet rarely matches a real project verbatim — you reconcile it against the patterns you sampled in §2 before touching any file.

For each entry, resolve four things in order:

1. **Snippet** — use the canonical snippet if it matches the sampled project pattern; else translate it into the sampled shape with the new class substituted. Show both so the developer can see the reconciliation. If the sampled patterns conflict, or there are no samples to learn from, ask rather than guess.
2. **Location** — anchor present → insert after it. Else after the last sampled occurrence of the same registration pattern. Else best-effort inside the bootstrap method (say so explicitly, so the developer can correct you). Else skip and print the snippet as a manual instruction.
3. **Consent** — show the `targetFile` + line range + `description` + the rendered snippet. Ask `[apply / different location / edit snippet / skip]`. Never apply without consent — wiring edits a file the developer owns.
4. **Idempotent** — search the target for the snippet first. If it is already present, do not re-insert; report that it was already wired.

The reasoning behind this order: choosing the right snippet shape first means the consent prompt shows the developer exactly what will land in their file, and resolving location before asking means the prompt names a concrete insertion point rather than a vague "somewhere near the top".

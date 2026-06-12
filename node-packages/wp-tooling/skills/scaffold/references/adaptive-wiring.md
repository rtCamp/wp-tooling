# Adaptive Wiring

Use this file when you're applying `ai.wiring` entries from an engine result (§6a of the workflow).

For each `{ targetFile, anchor, snippet, description }`:

1. **Snippet** - use canonical if it matches the sampled project pattern; else translate using the sampled shape with the new class substituted. Show both. If patterns conflict or no samples exist, ask.
2. **Location** - anchor present → after it; else after the last sampled occurrence of the pattern; else best-effort in bootstrap method (say so); else skip and print as manual instruction.
3. **Consent** - show targetFile + line range + description + rendered snippet. Ask `[apply / different location / edit snippet / skip]`. Never apply without consent.
4. **Idempotent** - search first, do not re-insert.

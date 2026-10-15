# Seal — `@warlock.js/seal`

The validation engine that powers `@warlock.js/core` (`v.*` factory) and downstream packages (`cascade` model schemas, `ai` Standard Schema interop, request validation in HTTP handlers).

## Status

Domain bootstrapped 2026-05-12 to track an optional/nullable/default audit triggered by a Faq-model bug (record + array fields silently materialising as `{}` / `[]` when absent). Earlier seal work lives in commit history under `@warlock.js/seal/` — see git log for context.

## Folder index

- [`backlog.md`](./backlog.md) — open work
- [`plans/`](./plans/) — implementation playbooks (active + archived)
- [`design/`](./design/) — locked decisions and architectural specs
- [`docs/`](./docs/) — user-facing recipes and how-tos

`walkthrough/` will be added if a phase warrants narrative review.

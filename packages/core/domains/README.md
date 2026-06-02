# domains/core/

The framework domain — **`@warlock.js/core`** itself, the engine package every Warlock app boots into. Everything in this folder describes the framework: its docs, its plans, its internal architecture, its marketing positioning.

User-facing docs live in [`docs/`](./docs/). Internal architecture lives in [`how-it-works/`](./how-it-works/). Implementation plans live in [`plans/`](./plans/).

## Folders

| Folder              | Purpose                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| [`docs/`](./docs/)  | User-facing documentation (Docusaurus-served). Getting started, essentials, guides, recipes, reference. |
| [`how-it-works/`](./how-it-works/) | Internal architecture — dev server, transpile cache, loader hooks. Not user-facing.    |
| [`plans/`](./plans/) | Active and archived implementation plans (one per initiative).                         |
| [`marketing.md`](./marketing.md) | Positioning + adoption playbook for the framework.                                     |
| [`backlog.md`](./backlog.md) | Feature backlog.                                                                       |

## Status

- **Docs (Docusaurus)** — in progress. Slice 1 (getting-started + four foundational skills) shipped per [`plans/2026-05-22-core-docs-restructure.md`](./plans/2026-05-22-core-docs-restructure.md).
- **Skills** — at `@warlock.js/core/skills/`, one folder per task. Slice 1 shipped: `warlock-conventions`, `register-route`, `create-controller`, `send-response`.
- **HTTP middleware suite (2026-05-24)** — code + skill + docs shipped per [`plans/2026-05-24-http-middleware-suite.md`](./plans/2026-05-24-http-middleware-suite.md). Adds `rateLimit`, `concurrencyLimit`, `maxBodySize`, `idempotency`, `maintenance`, `ipFilter` middlewares + `X-Request-Id` inherit/echo. Unit tests + reference doc deferred. See [`design/decisions.md`](./design/decisions.md) for locked-in semantics.
- **llms.txt / llms-full.txt** — generated under `docs/`. Run `node domains/core/scripts/generate-llms-txt.mjs` after any docs change.

## See also

- The companion engine docs in [`@warlock.js/core/docs/`](../../@warlock.js/core/docs/) are legacy package-shipped docs; the canonical user docs live here under `docs/`.
- The skills folder at [`@warlock.js/core/skills/`](../../@warlock.js/core/skills/) — assistant skills for editing Warlock projects.
- Cross-cutting decisions live in [`domains/shared/decisions.md`](../shared/decisions.md). Framework-specific decisions, once locked, land in `domains/core/design/decisions.md` (folder created on first decision).

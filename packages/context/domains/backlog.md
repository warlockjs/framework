# `@warlock.js/context` — backlog

Findings from the release-polish pass (2026-06-01). Newest first.

## 2026-06-01 — Release polish (skills + tests + docs)

### Done this pass

- **Tests added.** `vitest.config.ts` created (matches the `fs` package pattern:
  `tests/**/*.test.ts`, node env, 10s timeout). Two suites, **25 tests, all green**:
  - `tests/base-context.test.ts` — `run` scoping/cleanup/throw-cleanup, concurrent
    isolation between parallel `run()` calls, `get`/`getStore`, `update` (merge +
    enter-when-empty), `set` sugar, `enter`, `clear` (empties store but keeps
    `hasContext()` true), `hasContext` empty-vs-absent, `buildStore` defaults.
  - `tests/context-manager.test.ts` — `register` chaining + same-name overwrite,
    `buildStores` calling each `buildStore`, `runAll` activation + registration-order
    nesting + empty-store seeding for unmatched keys, `enterAll` truthy-only entry,
    `clearAll`, `getContext`, `unregister`, singleton identity.
  - Run with: `cd D:/xampp/htdocs/mongez/node/@warlock.js && npx vitest run --root context`.
- **Docs fixed (drift / broken links):**
  - `getting-started/02-installation.mdx` — broken `../../../core/docs/getting-started/01-introduction`
    → `../../../core/getting-started/01-introduction` (no `docs/` segment under `core/`).
    Was flagged HIGH in `discussions/2026-05-29-docs-review-findings.md`.
  - `index.mdx` — replaced the stale "Full Diátaxis tree is still being written …
    go to skills" claim with intent links to the now-complete sections (the tree
    exists and is wired into the sidebar).
  - `reference/api.md` — Source links pointed at a non-existent path
    (`github.com/warlock-js/warlock/blob/main/packages/context/src/...`). Corrected to
    the real repo: `github.com/warlockjs/context/blob/main/src/...`.
  - `guides/use-in-workers-and-jobs.md` — "no inbound request" → "no incoming request"
    (project convention forbids inbound/outbound terminology).
- **Docs enriched.** `getting-started/01-introduction.md` gained a ~15-line copy-paste
  "The whole idea in fifteen lines" dive-in showing the core value (read a value five
  frames deep without ever passing it). Verified against source.
- **Skills.** All 3 verified accurate vs `src/` — no API drift, no invented methods.
  Fixed `overview/SKILL.md` "See also" to the name-based cross-link form
  (`@warlock.js/core/overview/SKILL.md`) and dropped the broken relative agent-kit
  link, matching the newer `cache` overview convention.
- **llms regenerated** via `node scripts/generate-llms.mjs` (3 skills) — reflects the
  skill edits.

### Open / noted (not changed this pass)

- **`@warlock.js/core` overview skill is not present in this checkout.** Both `cache`
  and `fs` overview skills also reference `@warlock.js/core/overview/SKILL.md` /
  `@warlock.js/core/warlock-conventions/SKILL.md`, so the name-based reference is the
  established house pattern (resolved at agent-kit sync time across the published
  package set, not a filesystem path in this repo). Left as-is to match siblings.
  Revisit if the core skill folder is renamed.
- **`fs` overview still uses the old relative agent-kit link** (`../../../../domains/shared/skills/`).
  Out of scope for context, but worth a sweep across all package overviews to land on
  one convention (the `cache`/`context` plain-text form).
- **`package.json` has no `scripts.test`.** Per-package `npx vitest` is broken by the
  workspace symlink (must run from the monorepo root with `--root context`). Consider a
  root-level test script or documenting the command so contributors don't trip on it.
- **No `delete(key)` on `Context`** — by design (append-only within a scope; the docs
  call this out). Not a gap; recording so it isn't "fixed" later by mistake.

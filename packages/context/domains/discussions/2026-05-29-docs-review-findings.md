# 2026-05-29 — Context docs review findings

**Source:** Opus review agent, read-only audit of published Starlight docs vs `@warlock.js/context/src` + skills.
**Scope of fix (separate session):** apply in lockstep — docs **and** skills + llms regen + build-verify. Read `domains/shared/skills/update-package/SKILL.md` first.

Paths:
- Docs: `@warlock.js/docs/src/content/docs/v/latest/context/`
- Source: `@warlock.js/context/src/`
- Skills: `@warlock.js/context/skills/`

## Axis 1 — Documentation quality & drift
**Clean on API accuracy.** Every documented member of `Context<TStore>` (`run`, `enter`, `update`, `getStore`, `get`, `set`, `clear`, `hasContext`, abstract `buildStore`) and `ContextManager` (`register`, `unregister`, `buildStores`, `runAll`, `enterAll`, `clearAll`, `getContext`, `hasContext`) matches `base-context.ts` / `context-manager.ts` exactly, including fine points (`clear()` keeps `hasContext()` true; `set` is sugar for `update`; `enterAll` truthy check). No invented methods.

- **LOW — stale status claim.** `index.mdx:25-29` says "Full Diátaxis tree is still being written … the per-task skills cover every piece" and links only to `/skills/`. False — a complete getting-started/essentials/guides/reference tree exists and is wired into the sidebar. Fix → replace with intent links to the actual sections.

## Axis 2 — Broken links
- **HIGH — `getting-started/02-installation.mdx:88`** → `../../../core/docs/getting-started/01-introduction`. There is **no `docs/` segment** under `core/` (`core/getting-started/01-introduction.md` exists; `core/docs/` does not). From `context/getting-started/`, `../../../` reaches `v/latest/`, so correct target is `../../../core/getting-started/01-introduction`. Fix → drop `/docs`. *(Same `/docs` bug appears in Auth — fix both together.)*

All other cross-links resolve (`../guides/define-a-context`, `../guides/orchestrate-contexts`, `../essentials/*`, `../reference/api`, etc. all present). No abandoned-layout rot, no `domains/` leaks, no broken anchors.

## Axis 3 — Sidebar & DX
Clean. `contextSections = fullSections.filter(s => s.dir !== "recipes")` (`astro.config.mjs:78,120`) → getting-started/essentials/guides/reference; all dirs exist, every page has `sidebar.order`+`label`. No orphans/dangling.
- **LOW (DX):** the "tree still being written → go to skills" framing on Overview undercuts the already-complete sidebar — same fix as Axis 1.

## Priority
One real broken link (HIGH, the `/docs` segment) + one stale "not written yet" claim (LOW). No drift, no invented methods. Context did **not** inherit Cascade's two problem classes.

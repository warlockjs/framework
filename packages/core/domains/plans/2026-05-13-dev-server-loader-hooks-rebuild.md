# 2026-05-13 — Dev Server Rebuild: Loader-Hook-Based ESM Architecture

**Status:** in-progress (Phase 1 implemented, pending smoke test)
**Started:** 2026-05-13
**Implemented:** 2026-05-15 — loader hook files created, module-loader / layer-executor / file-manager / files-orchestrator modified; no commit yet (Hasan to test first)
**Context:** Discussion thread on cycle support + `lazy()` resource refs. Current dev server transforms every static `import` into `await __import("./flat-name.js?t=TS")` for HMR cache-busting; that transformation breaks ESM cycles (awaits deadlock where live bindings would resolve). Files: `@warlock.js/core/src/dev-server/import-transformer.ts`, `runtime-import-helper.ts`, `dependency-graph.ts`. Triggering case lives at `src/app/examples/resources-circular/` (currently hangs the dev server).

## Why

Current architecture has hit its ceiling:

- ESM cycles deadlock — `await __import(...)` blocks where live bindings would resolve naturally
- `lazy(() => OtherX)` works in production (native ESM) but fails in dev — broken dev/prod parity, no acceptable workaround
- Flat-name cache layout (`src-app-X.js`) breaks sourcemap original-path semantics + error stacks
- Regex-based transformer is fragile against new TS/JS syntax
- The whole "static import → awaited dynamic import" pattern predates Node's official loader-hooks API; not idiomatic for Node 20+

## Goals

- Native ESM cycle handling in dev (matches production)
- HMR cold start + per-change reload latency at or below current numbers
- `lazy()` works in dev identically to production
- Sourcemaps point to original source files; error stacks readable
- Foundation built on official, stable Node primitives — won't bit-rot

## Non-goals

- Production builds (already native ESM via esbuild)
- Replacing HMR as a concept (just its implementation)
- CommonJS support (project is ESM-only)
- Rewriting the file watcher / orchestrator / dep graph (extends, doesn't replace)
- A Vite-style HMR-accept boundary protocol (deferred to a follow-up if needed)

## Approach

Replace the import-transformation pipeline with [Node's `module.register()`](https://nodejs.org/api/module.html#moduleregisterspecifier-parenturl-options) loader hooks.

1. User code uses native `import` syntax. **No source-level transformation.**
2. A loader hook intercepts `resolve()` and `load()` for project + framework files.
3. The hook tracks per-module versions internally (current `__import` timestamp logic, lifted to the platform level).
4. File-watcher events bump version numbers in the hook; subsequent dynamic-import access fetches fresh content.
5. ESM cycles work natively because static imports stay static — Node's spec-compliant cycle handling kicks in.

The dep graph, file watcher, layer executor, special-files collector all stay. The transformer, runtime-import-helper, and import-deduplicator are deleted.

## Tasks

### Phase 0 — spike + design lock (~3 days)

- [x] Read Node 22 loader-hooks docs end-to-end (`module.register`, `globalPreload`, `resolve`, `load`, `initialize`) — resolved from prior research; skipped formal spike, went direct to implementation
- [x] Spike: cache-bust verification — `?v=N` token on URL causes Node cache miss; verified by design
- [ ] Spike: cycle verification — A imports B, B imports A — confirm native ESM cycle handling (Phase 3)
- [ ] Spike: top-level-await module + cyclic peer — confirm no deadlock (Phase 3)
- [ ] Spike: decorator emit via esbuild matches current pipeline — tsx handles transpilation, esbuild only bundles hook-thread.ts (Phase 3)
- [ ] Write `domains/core/design/dev-server.md` — captures the new pipeline as a spec (Phase 5)
- [ ] Append `domains/core/design/decisions.md` entry for the architectural choice (Phase 5)

### Phase 1 — loader hook foundation (~4 days)

- [x] New: `@warlock.js/core/src/dev-server/loader/` folder
- [x] `loader/resolve-hook.ts` — delegates to tsx chain; stamps `?v=N` on src/ `.ts`/`.tsx` URLs; strips `?v=N` from `parentURL` before forwarding to prevent URL-join corruption
- [x] `loader/load-hook.ts` — strips `?v=N` before forwarding to tsx; tsx handles disk read + transpile
- [x] `loader/version-registry.ts` — `Map<absolutePath, monotonic-counter>` in hook worker thread
- [x] `loader/hook-thread.ts` — exports `initialize`, `resolve`, `load`; wires MessageChannel port for bump messages
- [x] `loader/register-loader.ts` — esbuild-bundles hook-thread.ts to `.warlock/loader-hook.mjs`; calls `module.register()`; returns `port1` for main thread; ensures `.warlock/` directory exists
- [x] Registration wired inside `filesOrchestrator.init()` (before any user src/ import) — no `cli/start.ts` change needed
- [x] Wire `filesOrchestrator.bumpVersion()` → `layerExecutor` constructor arg → called on file change
- [ ] Smoke test: dev server boots, imports resolve, single file HMR works ← **Hasan testing**

### Phase 2 — feature parity (~5 days)

- [x] Module cleanup-on-shutdown semantics — `ModuleLoader.registerCleanup()` scans for `export function cleanup()` and `.$cleanup` on all exports; called after every `loadModule()`
- [x] `export * from` re-export support — works natively (no transform needed)
- [x] Mixed default + named imports parity — works natively (static imports preserved)
- [x] Decorator transform parity — tsx uses esbuild internally, same TS target as before
- [x] All connector, special-files, and route flows preserved — no changes to those layers
- [ ] tsconfig path-alias resolution — tsx already handles this; verify in smoke test
- [ ] `.warlock/`-internal generated special files verify they still load correctly (Phase 3)

### Phase 3 — cycle + lazy() validation (~2 days)

- [ ] `dependency-graph.ts` — relax cycle warning: a cycle with all-runtime edges is now genuinely safe; downgrade to info-level or remove unless the user explicitly opts back in
- [ ] Run `runResourcesCircularDemo` (currently hangs) — must pass
- [ ] Run every example in `src/app/examples/` — confirm no regression
- [ ] HMR smoke: edit a model, dependents refresh; edit a route, change picks up
- [ ] Edge: TLA module + cyclic peer
- [ ] Edge: `@RegisterModel()` decorator + cyclic relation — registry correctly populated

### Phase 4 — remove the old pipeline (~2 days)

- [ ] Delete `import-transformer.ts`
- [ ] Delete `runtime-import-helper.ts`
- [ ] Delete `import-deduplicator.ts`
- [ ] Audit `parse-imports.ts` — keep what dep-graph still needs, delete the rest
- [ ] Strip the global `__import` / `__clearModuleVersion` declarations
- [ ] Drop timestamp-cache-busting from `transpile-file.ts`
- [ ] Sweep unused utilities; delete

### Phase 5 — docs + decisions + walkthrough (~1 day)

- [ ] Update `@warlock.js/docs/core/dev-server.md` (or create) with the new pipeline
- [ ] Append `domains/shared/decisions.md` cross-domain entry — dev-server loader-hook migration
- [ ] `domains/core/walkthrough/YYYY-MM-DD-dev-server-loader-hooks.md` — file-by-file tour of the new pipeline
- [ ] Update `domains/core/backlog.md` — close this item, list any follow-ups surfaced

## Risks / unknowns

| Risk | Mitigation |
|---|---|
| Loader hooks run in a worker thread; cache-invalidation timing across the boundary | Phase 0 spike validates end-to-end before commit |
| npm packages with weird resolution (subpath / conditional exports) | Pass through `nextResolve` for anything outside `src/` + linked framework sources |
| Decorator emit subtle drift via runtime esbuild | Phase 3 runs all existing tests + example demos |
| File-watcher → version-bump race with in-flight imports | Atomic version updates; verify with TLA-stress test |
| Performance regression vs current pipeline | Bench cold start + per-change reload at Phase 1 end; bail to alternative caching if regressed |
| Source-map quality on transpiled files (line/column drift) | Use esbuild `sourcemap: "inline"` + Node `--enable-source-maps` |

## Estimated effort

~17 working days focused. Plus contingency for Phase 0 unknowns → **3-4 weeks elapsed**.

## Open questions / recommendations

1. **Versioning strategy** — string token, monotonic integer, or filesystem mtime hash.
   **Recommendation:** monotonic integer per absolute path. No clock drift; trivial to reason about.

2. **Hook scope** — only project `src/`, or also project-linked `@warlock.js/*` sources?
   **Recommendation:** both. The framework packages live as linked sources in this repo and need cycle support too. `node_modules` always passes through `nextResolve`.

3. **Old pipeline removal timing** — delete in Phase 4, or keep dual-mode for one release?
   **Recommendation:** delete in Phase 4. Pre-1.0; dual-mode doubles test surface for negligible safety. Hard cutover with the migration doc.

4. **Sourcemap mode in dev** — inline vs external `.map` files.
   **Recommendation:** inline. No extra fetch, Node's source-map support reads it directly.

5. **HMR boundary semantics** — keep the transitive-dependents invalidation chain, or move to Vite-style explicit `import.meta.hot.accept`?
   **Recommendation:** keep the existing invalidation chain in v1 of the rebuild. The framework's auto-discovery + module-level isolation makes the chain reliable. `import.meta.hot` is a larger DX decision worth its own design pass.

6. **TLA stress** — current pipeline handles app-code top-level await; confirm native loader hooks don't introduce new ordering bugs (esp. with `await connectorsManager.startPhase(...)` patterns in the production app entry).
   **Recommendation:** explicit Phase 0 spike covers this; Phase 3 edge-case tests verify.

7. **CLI override surface** — should the CLI gain a `--legacy-dev-server` flag during the migration in case the new pipeline misbehaves in some user's project?
   **Recommendation:** no. Dual-mode for a single release maybe; permanent flag, no — it would freeze the legacy code forever.

## Summary

_(written on completion)_

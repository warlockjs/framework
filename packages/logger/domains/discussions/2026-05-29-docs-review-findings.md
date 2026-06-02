# 2026-05-29 — Logger docs review findings

**Source:** Opus review agent, read-only audit of published Starlight docs vs `@warlock.js/logger/src` + skills.
**Scope of fix (separate session):** apply in lockstep — docs **and** skills + llms regen + build-verify. Read `domains/shared/skills/update-package/SKILL.md` first.

Paths:
- Docs: `@warlock.js/docs/src/content/docs/v/latest/logger/`
- Source: `@warlock.js/logger/src/`
- Skills: `@warlock.js/logger/skills/`

## Axis 1 — Documentation quality & drift

**HIGH — `index.mdx` HighlightFeatures block: 3 of 4 cards use invented/uncompilable APIs.** (Block is self-flagged placeholder at `index.mdx:15-16` — "to be verified and rewritten during the formal logger audit".)
- `index.mdx:30` — `log.channel("audit").info(...)`. `Logger.channel(name)` returns `LogChannel | undefined` (`logger.ts:341-343`); `LogChannel` has **no `.info()`**, only `log()`. There is no "log to one channel" API. Fix → `log.info("audit", "login", "ok", { userId })`.
- `index.mdx:42` — `await log.flush()`. Only `flushSync(): void` exists (`logger.ts:348`) — sync, not awaitable. Fix → `log.flushSync() // before process.exit`.
- `index.mdx:34` — PII redaction card `log.info("signup", { email, token })`. Positional signature is `(module, action, message, context?)` — `{email,token}` lands in `action`, not context; and redaction only matches `context.*`/`message.*` paths (`redaction.md:128-130`), so nothing would be scrubbed. Fix → `log.info("auth", "signup", "ok", { email, token })` + configured `paths: ["context.token"]`.

**LOW — `index.mdx:40`** — "flush on uncaughtException" overstates auto-flush. `AutoFlushEvent` (`types.ts:11-17`) covers signals + `beforeExit` only. Fix → say "SIGTERM/SIGINT/beforeExit".

Rest of prose pages (getting-started, channels, advanced, reference) verified **accurate** — signatures, defaults (`maxMessagesToWrite:100`, `maxFileSize:10MB`, `chunk:"single"`), channel names (`console`/`file`/`fileJson`), `info≈success` rank, `LogMessage`/`LogContract`/`RedactConfig`, `applyRedact`/`mergeRedact`/`safeJsonStringify`, the `setTimeout(0)` init window all check out.

## Axis 2 — Broken links
Clean. No `../essentials/`·`../guides/` rot, no `domains/` leaks, no broken anchors.

## Axis 3 — Sidebar & DX
Clean. Custom 4-group sidebar (`astro.config.mjs:87-119`), every page has `sidebar.order`, no orphans/dangling.

## Priority
Single must-fix: rewrite the `index.mdx` HighlightFeatures block (it's the landing page; 3 cards uncompilable). Everything downstream is solid.

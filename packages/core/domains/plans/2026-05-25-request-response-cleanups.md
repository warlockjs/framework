# 2026-05-25 — Request / Response cleanups

**Status:** not-started
**Started:** —
**Context:**

- `@warlock.js/core/src/http/request.ts` (~996 lines), `response.ts` (~1220 lines) — both have grown to god-object size, mixing transport / domain / infrastructure concerns.
- This session's senior review surfaced 14 distinct smells across both classes; plus one bug in `cache-response-middleware.ts` (covered by the cache overhaul plan).
- Hasan agreed with the assessment; this plan organizes the work into 7 phases by risk/value.
- Sibling plan: [`2026-05-25-cache-middleware-overhaul.md`](./2026-05-25-cache-middleware-overhaul.md) — depends on Phase A here.

**Approved direction (from this session's discussion):**

- **`baseResponse` / `baseRequest` stay PUBLIC** as legitimate escape hatches. Hasan's case: streaming was implemented downstream-of-framework before the framework supported it natively. The escape hatch is the release valve that lets consumers move faster than the framework. Action this plan takes: **document the contract** ("use when the framework lacks a helper; flag a missing helper if you reach here for non-streaming work"), don't lock it down.
- **Full Request/Response decomposition** (5-class split into HttpTransport / RequestData / RequestContext / ResponseBuilder / ResponseEmitter) is **out of scope here**. Files as a future-cycle exploration doc; this plan handles the smaller cleanups.

**Already done this session (no task needed):**

- `Request.current` static — removed (was global-singleton anti-pattern).
- `clearCurrentUser()` method — removed from Request AND the call removed from auth middleware. Clean.
- `tooManyRequests()` + `contentTooLarge()` Response helpers — added.
- `X-Request-Id` inherit + echo — wired.

---

## Phase A — Cache-aligned response helpers

**Status:** code shipped 2026-05-25; tests deferred (see "Test infrastructure gap" below).

**Goal.** Make cache-pattern replay correct + safe across all cached middlewares.

**Files:**

- `@warlock.js/core/src/http/response.ts` — added `replay()`, added double-send guard, made `send()` respect explicit content-type
- `@warlock.js/core/src/http/middleware/idempotency.middleware.ts` — migrated HIT path to `replay()`, extended `CachedResponse` shape with `contentType`
- `@warlock.js/core/src/http/middleware/cache-response-middleware.ts` — will use `replay()` in its overhaul (per the cache plan, no extra task here)

**Breaking change:** none. Additive.

**Tasks:**

- [x] `Response.replay(cached: { status: number; body: unknown; contentType?: string; headers?: Record<string, string> })` → sets status, content-type, extra headers, calls `send(body)`. Returns `Promise<Response>`.
- [x] `Response.send()` guard: if `this.baseResponse.sent === true`, `log.error("response", "send", ...)` + return early. Chose error-level log + early-return instead of throw so production traffic isn't crashed by a defensive check; logs still surface in any sane pipeline.
- [x] `Response.send()` content-type fix: the auto `application/json` assignment for object bodies now respects an already-set Content-Type. Found while drafting replay tests — without it, `replay({ contentType: "application/vnd.api+json", body: {...} })` was silently overwritten. Required for replay's contract to hold; documented as a non-breaking improvement (existing callers that didn't set Content-Type still get the auto JSON).
- [x] Migrated `idempotency.middleware.ts` HIT path to `replay()`. Same change fixes the same lurking FastifyReply-return bug that motivated the cache overhaul — `baseResponse.status() + baseResponse.send()` hand-roll dropped.
- [x] Extended idempotency's `CachedResponse` shape: added `contentType?: string` so non-JSON responses replay with the right MIME type.
- [ ] Cache middleware uses `replay()` in its overhaul (per the cache plan, no extra task here).
- [ ] **Vitest coverage — deferred.** Tests for `replay()` + double-send guard + content-type preservation were written but couldn't run cleanly: vitest's default Node resolution doesn't find workspace siblings (`@warlock.js/fs`, `@warlock.js/context`, ...) that `response.ts` transitively pulls in. Mocking each one is brittle cargo-cult; the right fix is a one-time vitest alias setup for the HTTP layer. File a follow-up plan or include as a task in the cache overhaul PR.

**Test infrastructure gap.** The existing `tests/unit/*.test.ts` in `@warlock.js/core` deliberately don't touch the HTTP layer — they test isolated infrastructure (source-slug, transpile-cache, own-resolver) that doesn't reach into `@warlock.js/*` siblings. Testing Response/Request requires either: (a) vitest aliases mapping each `@warlock.js/<pkg>` to `../<pkg>/src/index.ts`, or (b) a workspace-aware test runner. Option (a) is the smaller lift; ~10 alias entries in `vitest.config.ts`. Recommend handling alongside the cache overhaul PR so the cache replay can ship with real test coverage.

**Deps:** none. Code lands now; tests follow with the cache PR.

---

## Phase B — Small cleanups + escape-hatch contract

**Status:** shipped 2026-05-29 (originally applied 2026-05-25; lost in a workspace reorg; re-applied unchanged).

**Goal.** Quick consolidations + write down the "fall back to Fastify" contract so it's deliberate, not accidental.

**Files:**

- `@warlock.js/core/src/http/response.ts` — `isSending` removed; `CookieOptions` type added + exported; `cookie()` extended with `raw?: boolean`; `baseResponse` JSDoc rewritten as escape-hatch contract.
- `@warlock.js/core/src/http/request.ts` — `baseRequest` JSDoc rewritten as escape-hatch contract; `ip` / `detectIp()` JSDoc unified (peer vs proxy-aware); `runMiddleware`, `getHandler`, `execute`, `executeMiddleware`, `collectMiddlewares` all marked `@internal`.
- `@warlock.js/core/skills/send-response/SKILL.md` — cookies section updated to show both JSON-wrapped (default) and `raw: true` patterns.
- `@warlock.js/core/skills/write-middleware/SKILL.md` — two new gotcha bullets: escape-hatch contract for `baseRequest`/`baseResponse`, and IP-reading story (`detectIp` vs `ip`).

**Breaking change:** none. `cookie()`'s new `raw` flag is additive.

**Tasks:**

- [x] Remove `isSending` field on Response (line 88) — dead state, never read.
- [x] `cookie(name, value, options?)` — extend `options` with `raw?: boolean`. When `true`, skip `JSON.stringify(value)`. Default `false` preserves existing behavior. Documented with `@example` for both paths. Exported new `CookieOptions` type from response.ts.
- [x] Unify the IP-reading story. JSDoc on `ip` says "immediate peer"; JSDoc on `detectIp()` says "prefer this behind any proxy; honors X-Real-IP / X-Forwarded-For." Both kept as-is per the open-item recommendation.
- [x] **Escape-hatch contract.** Added JSDoc to both `baseRequest` and `baseResponse` framing them as escape hatches: prefer framework helpers, reach here only when the framework lacks a capability, file an issue when you do, streaming/SSE are the historical precedent.
- [x] Marked `runMiddleware`, `getHandler`, `execute`, `executeMiddleware`, `collectMiddlewares` with `@internal` JSDoc tags. TypeScript doesn't enforce, but signals "not API; do not call from app code." Helps when we extract these in Phase G.

**Deps:** none. Independent quick-win PR.

---

## Phase C — Error registry

**Goal.** Convert the 60-line switch statement in `handleRequestError` (inject-request-context.ts) to an extensible registry. Packages register their error class → response mapping; framework dispatches.

**Files:**

- `@warlock.js/core/src/http/error-handler.ts` (new) — registry + dispatch
- `@warlock.js/core/src/http/middleware/inject-request-context.ts` — call the registry
- `@warlock.js/core/src/http/errors/` — existing error classes register themselves (or framework registers them in init)
- `@warlock.js/auth`, `@warlock.js/cascade` — can register their own error → response mappings

**Breaking change:** none if framework registers existing mappings (`HttpError`, `ResourceNotFoundError`, `UnAuthorizedError`, `ForbiddenError`, `BadRequestError`, `DatabaseWriterValidationError`, `ServerError`) at boot.

**Tasks:**

- [ ] `errorRegistry.register(ErrorClass, (error, response) => Response)` API.
- [ ] Framework registers the seven existing mappings at boot (preserves current behavior).
- [ ] `handleRequestError` becomes: walk the registry for a matching class, call its mapper, fall back to the current catch-all `response.badRequest({ error: error.message, ...payload })`.
- [ ] Test: registering a new error class works; existing behavior preserved (snapshot the current 7 mappings); fallback still kicks in for unregistered errors.
- [ ] Docs: add a recipe `domains/core/docs/recipes/custom-error-mapping.md`.
- [ ] Skill: `write-middleware/SKILL.md` mentions the registry in the "Don't throw for HTTP-shaped failures" gotcha (now there's a clean way to do exactly that).

**Deps:** none. Independent. Medium PR.

---

## Phase D — _(considered + rejected: middleware lifecycle hooks)_

**Considered.** Adding `beforeMiddleware` / `afterMiddleware` / `onMiddlewareError` events to instrument tracing / metrics / audit / debugging around every middleware execution.

**Rejected as over-engineering.** Reasons:

1. **No real consumer asking for it.** Use cases were hypothetical; the framework hasn't been blocked by lack of these hooks in any concrete way.
2. **`request.log()` already covers debugging.** [`request.ts:604-606`](../../../@warlock.js/core/src/http/request.ts) logs `"Executing middleware X"` / `"Executed middleware X"` for every middleware. If granularity isn't enough, enhance the logger.
3. **Tracing / metrics / audit are solved by the wrapping pattern.** Write a meta-middleware (`traceMiddleware`) and put it first in the chain. That's the framework's existing composition idiom; adding implicit lifecycle hooks bypasses it.
4. **Philosophical conflict.** This framework favors EXPLICIT composition — middlewares declared in arrays, run in order, return values determine flow. Implicit hooks that fire around every middleware violate that contract.
5. **API surface bloat.** Three new events to document, support, mention in every middleware skill.
6. **Performance overhead** on every middleware execution, even with zero subscribers.

**Action taken instead:** add a one-line note in `write-middleware/SKILL.md` recommending the wrapping pattern for tracing/metrics; defer writing an actual `traceMiddleware` recipe until a real use case materializes.

---

## Phase E — Document the two-channel event contract

**Goal.** Reframe the two event APIs as **complementary, not redundant** (per Hasan's pushback). Today the codebase has:

- **Static / module-level** — `Response.on("sent", cb)` — subscribed once at boot, fires for **every** response instance. For cross-cutting plugins (telemetry, structured logging, response-time histograms, security headers, audit trails).
- **Instance-level** — `response.onSent(cb)` — subscribed by middleware during a request, fires only for **this** response, garbage-collected with it. For per-request work (cache writes, concurrency counter decrement, idempotency cache writes).

The two axes — subscriber lifetime (boot vs per-request) × scope (all responses vs this one) — are genuinely orthogonal. Collapsing either direction makes the natural case awkward.

The real problem isn't redundancy; it's **discoverability** (a reader sees both APIs in `response.ts` with no guidance on when each applies) and **naming asymmetry** (`response.onSending` instance vs `Response.on("sending", ...)` static — different API shapes for sibling concepts).

**Files:**

- `@warlock.js/core/src/http/response.ts` — JSDoc on both APIs explaining the contract + cross-referencing each other
- `@warlock.js/core/src/http/request.ts` — same treatment for request-level events
- `@warlock.js/core/skills/write-middleware/SKILL.md` — add a "Hooking into response events" section spelling out which to pick for which use case

**Breaking change:** none. Documentation + (optionally) naming additions only.

**Tasks:**

- [ ] JSDoc on `response.onSending`/`onSent` (instance) explaining: scoped to THIS response, garbage-collected at completion, intended for per-request middleware cleanup.
- [ ] JSDoc on `Response.on(event, cb)` (static) explaining: cross-cutting, fires for EVERY response, intended for boot-time plugins.
- [ ] Both JSDocs link to each other ("for per-request scope, use `response.onSent`" / "for cross-response plugins, use `Response.on`").
- [ ] **Decide on naming alignment** (open item #4): keep current names or rename one to match the other's shape. Recommend keep — both shapes are idiomatic in their context (instance method vs class method), forcing them into the same shape adds friction.
- [ ] `write-middleware/SKILL.md` gets a "Hooking into response events" section: two-table contrast, one code snippet each, "pick by subscriber lifetime."
- [ ] Optional: add `response.offSending(cb)` / `response.offSent(cb)` if any current consumer needs manual unsubscribe (today the only path is "let it die with the response"). Skip if no consumer hits it.

**Deps:** none. Tiny PR. Can land anytime.

---

## Phase F — Decompose `Response.send()`

**Goal.** Split the ~120-line `send()` into 4 protected stages: compose body → fire pre-events → write → fire post-events. Same external API, cleaner internals, easier to test, easier to slot in new middlewares like response compression / response encryption.

**Files:**

- `@warlock.js/core/src/http/response.ts` — refactor `send()` only

**Breaking change:** none. Pure internal refactor.

**Tasks:**

- [ ] Extract `protected async composeBody()` — sets `currentBody`, picks content-type, calls `parseBody()` if needed. Returns the parsed body.
- [ ] Extract `protected async firePreSendEvents()` — `sending`, `sendingJson`, `sendingSuccessJson`.
- [ ] Extract `protected async writeBody(body)` — `baseResponse.status(...)` + `baseResponse.send(body)`.
- [ ] Extract `protected firePostSendEvents()` — `sent`, success/error/status-specific events.
- [ ] `send()` becomes ~15 lines: orchestrates the four phases. Existing behavior identical.
- [ ] Same tests pass (snapshot the current behavior, refactor, re-run).

**Deps:** none. Low-risk refactor.

---

## Phase G — Request orchestration extraction

**Goal.** Move `runMiddleware`, `executeMiddleware`, `getHandler`, `collectMiddlewares` off Request into a dedicated `MiddlewareRunner` / `ControllerDispatcher` concept. Request becomes a pure value object (headers, body, route, user). The dispatcher owns "given a request + a route, drive middleware + handler to completion."

**Files (heavy):**

- `@warlock.js/core/src/http/controller-dispatcher.ts` (new) — `dispatch(request, response)`
- `@warlock.js/core/src/http/request.ts` — strip out `runMiddleware`, `executeMiddleware`, `getHandler`, `collectMiddlewares`, `execute()`
- `@warlock.js/core/src/http/middleware/inject-request-context.ts` — call the dispatcher instead of `request.runMiddleware()`
- Anywhere else that calls `request.runMiddleware()` — migrate

**Breaking change:** **YES, real one.** Anyone calling `request.runMiddleware()` from app code breaks. JSDoc `@internal` (Phase B) signals it's not API, but TS doesn't enforce — likely some apps do call it.

**Tasks:**

- [ ] Create the dispatcher with the same logic.
- [ ] Audit grep for app-code consumers of `request.runMiddleware()` / `request.execute()`.
- [ ] Migrate consumers (likely zero outside the framework, but verify).
- [ ] Tests: dispatcher behavior matches old Request behavior; error handling preserved; events fire in same order.
- [ ] Deprecate `request.runMiddleware()` / `request.execute()` as no-op stubs that throw with a migration message for one minor; remove next major.

**Deps:** **Phases B, E, F** should land first — they touch the same surface and reduce risk of merge conflicts.

---

## Phase H — Future exploration (NOT in scope, file the doc)

**Goal.** Decompose the two god-objects into 5 single-responsibility classes — multi-week refactor with high migration cost; needs its own cycle.

**Action this plan takes:**

- [ ] Write `domains/core/design/request-response-decomposition.md` (status: Draft) when Phase F lands. Captures: the smell, the 5-class sketch (HttpTransport / RequestData / RequestContext / ResponseBuilder / ResponseEmitter), migration cost estimate, ordering, what unblocks. Doc only — no implementation tasks.
- [ ] Append a one-paragraph entry to `domains/core/design/decisions.md` pointing at the exploration doc.

**Deps:** Phase F should be done so the decomposition writeup reflects the cleaner internals.

---

## Phase ordering (recommended)

1. **A** — Cache PR (bundles `replay()` + double-send guard with cache overhaul).
2. **B** — Quick cleanups + escape-hatch docs. Low-risk, fast follow-up to A.
3. **E** — Document the two-channel event contract. Tiny PR.
4. **C** — Error registry. Independent, medium PR.
5. **F** — `send()` decomposition. Internal refactor.
6. **G** — Request orchestration extraction. Heaviest; lands last.
7. **H** — Exploration doc. After F.

A, B, C, E can land in any order (all parallel-friendly).
F can land anytime after A.
G depends on B, E, F.
H depends on F.

(Phase D was considered and rejected as over-engineering — see Phase D section above.)

---

## Open items

1. **Phase A double-send guard — `warn` vs `throw`?** Recommend **`warn`** (log at `error` level, not `warn`, so it surfaces in any sane log pipeline). Reason: throwing in production turns a hidden bug into a crashed request; logging makes the bug loud during dev/CI without breaking live traffic. Tradeoff: prod might not read its logs and the bug stays silent there too — mitigated by the error-level severity.

2. **Phase B `cookie(raw: true)` — opt-in or auto-detect string values?** Recommend **explicit opt-in via `raw: true`**. Reason: auto-detecting on `typeof value === "string"` makes the cookie API silently behavior-switch based on input type — a subtle footgun. Explicit flag is honest. Tradeoff: slightly more verbose for the common "I want a plain string cookie" case.

3. **Phase E — keep current naming asymmetry or align?** Recommend **keep** (`response.onSent` instance, `Response.on("sent", cb)` static). Reason: each shape is idiomatic in its context — instance method for per-instance subscription, class method for cross-instance subscription. Forcing them into the same shape adds friction without clarity. Tradeoff: readers must learn that the two APIs serve different scopes.

4. **Phase E — add `off*` helpers for instance handlers?** Recommend **defer** until a consumer needs manual unsubscribe. Today the only path is "let the handler die with the response", which is the common case. Adding `offSent` / `offSending` preemptively bloats the API.

5. **Phase G migration strategy — flag day or gradual?** Recommend **gradual via deprecation stubs**. Keep `request.runMiddleware()` as a thin shim that calls the new dispatcher for one minor with a deprecation warning; remove in the next major. Tradeoff: temporary code duplication; the alternative is a hard cut that breaks any app reaching into `Request` internals.

6. **Should Phase H be deferred or filed as a doc right after this plan?** Recommend **file the doc after Phase F lands**, not now. Reason: the doc will be more accurate after `send()` is decomposed (the 5-class sketch depends on what internal shape we end up with). Tradeoff: the topic stays floating in conversation memory for longer.

## Summary

(Updated on completion.)

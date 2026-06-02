# `@warlock.js/core` — design decisions

Append-only log of locked-in decisions for the framework. Newest first.

Format per entry: title + date + decision + reasoning + alternatives considered + scope/exclusions. Cross-domain decisions go in [`domains/shared/decisions.md`](../../shared/decisions.md) instead.

---

## 2026-05-29 — Use Cases overhaul: retry/benchmark/config/broadcast + typing

**Decided** during a senior review of `src/use-cases` + `src/benchmark` + `src/retry`. Full design in [`use-cases.md`](./use-cases.md); execution in [`../plans/2026-05-29-use-cases-overhaul.md`](../plans/2026-05-29-use-cases-overhaul.md).

### 1. Retry comes from `@mongez/reinforcements`; local `src/retry` is deleted

The local retry is unreleased and a near-duplicate. Reinforcements' `retry` adds `backoff` (linear/exponential) and we own it. **Hard prerequisite:** add a `shouldRetry` predicate to reinforcements first — without it use cases can't skip retrying validation/4xx errors (reinforcements' `onError` only observes). Option renamed `retryOptions` → `retry`. `currentRetry` tracked by the use case via the util's `onError(error, attempt)` (the util doesn't return it).

**Alternative rejected:** keep the local retry. Two retry utils to maintain; reinforcements is the canonical home.

### 2. Retry scoped to the handler, not the whole pipeline

Today `retry(execute)` re-runs `onExecuting` + guards + validation + before on every attempt — retrying a 4xx is pointless and re-firing `onExecuting` corrupts observers. Retry wraps **only** `handler`. `retryScope: "pipeline"` deferred until a real flaky-guard case appears.

### 3. Benchmark: `benchmark?: boolean | BenchmarkOptions`, handler-scoped, one config home

Forwarded straight to `measure()`. `measure` wraps the **handler** so latency reflects business logic, not the guard/validation prelude or retry sleeps. `use-cases.benchmark` is the single config source; `config.get("benchmark")` is reserved for standalone `measure()`.

### 4. Global config becomes first-class

`UseCaseConfigurations` is read today but has no `src/config/use-cases.ts` stub and isn't in `ConfigRegistry`, so it's `any` and undiscoverable. Ship the generator stub + register the key. Resolution per option: per-use-case ?? global ?? framework default.

### 5. Broadcast via a transport-neutral channel abstraction (not herald-named)

Mirrors the existing `BenchmarkChannel` idiom: core defines `UseCaseBroadcastChannel` + `UseCaseBroadcastEvent`; herald ships a `heraldBroadcast({ broker })` adapter, **structurally typed so core never imports herald**. Per-use-case declares WHAT (`broadcast?: boolean | { event?, output? }`); the global config declares HOW (`broadcast: { enabled, channels[] }`). **Channels are global-only** — a use case picks its event name, never its transport.

- **Naming:** rejected `HeraldUseCaseChannel` — baking one implementation's name into the abstraction defeats the purpose and collides with herald's own `channel()`.
- **Envelope, not bare payload** — consumers get `id` for tracing/idempotency under at-least-once delivery.
- **Success-only (v1)**, fan-out under `Promise.allSettled` + per-channel try/catch, no-op when disabled/disconnected.
- **Payload safety:** `broadcast: true` is output-as-is (fine for DTOs, risky for model `toJSON`); `{ output }` projector is the explicit escape hatch — no auto-stripping.
- **Alternative rejected (Design A):** explicit `channel`/`broker` on the option + core dynamic-imports herald. Thinner, but couples core to herald and doesn't match the `BenchmarkChannel` precedent.

### 6. Typing: schema→Input inference + typed `ctx`

`Input = Infer<typeof schema>` when a schema is present (drops the mandatory `<Input>`); a `Ctx` generic threads typed context through guards/before/after/handler. Plus: fix `benchmarkResult` type/runtime drift, drop the `schema!` lie, type the registry without `as`. Add a `description` field.

### 7. Harden global-observer dispatch

`fireLifecycleEvent` awaits global observers without try/catch — a slow/throwing subscriber stalls or breaks every use case. Isolate each. Prerequisite for safe broadcast + the built-in logging observer (gated by `use-cases.log`, via `@warlock.js/logger`; replaces the stray `console.error`).

### 8. Bug fixes bundled

Success counter incremented on failure (`use-case.ts:157`); dead `increaseUseCaseCalls`; unbounded history `:list` (add cap). `USE-CASES-DESIGN.md` + READMEs rewritten to kill drift.

**Scope exclusions:** per-use-case channel/broker override; error-event broadcasting; `retryScope: "pipeline"`; distributed history policy beyond a list trim — all deferred.

---

## 2026-05-29 — Request/Response Phase B — escape-hatch contract, cookie(raw), dead-state removal, @internal orchestration

**Decided** as Phase B of the Request/Response cleanups plan ([`2026-05-25-request-response-cleanups.md`](../plans/2026-05-25-request-response-cleanups.md)). Quick consolidations bundled because they share a theme: **make the framework's contracts deliberate, not accidental**.

### 1. `baseResponse` / `baseRequest` framed as explicit escape hatches

Both stay `public` per the framework-author pushback ("streaming and SSE shipped consumer-side before the framework added them; the escape hatch is the release valve that lets consumers move faster than the framework"). JSDoc on both fields now writes the contract down:

- Prefer framework helpers first (`response.send`, `response.header`, `response.replay`, `request.input`, `request.detectIp`, ...).
- Reach for the raw Fastify primitive only when the framework genuinely lacks a helper for what you need.
- When you do, file an issue so the helper gets added — every long-term reach into `baseRequest` / `baseResponse` is a missing helper waiting to be promoted.
- Streaming and SSE are the historical precedent and stay valid.

Same contract appears as a gotcha in `write-middleware/SKILL.md`. Direct callout to the cache + idempotency bugs as cautionary tales — both shipped quietly broken because they bypassed the helper layer.

### 2. `cookie(name, value, { raw: true })` option

`response.cookie()` JSON-stringifies values by default so structured cookies round-trip cleanly with `request.cookie(name)`. New `raw: true` opts out — write the value as-is for plain-string cookies (session tokens, opaque IDs).

**Why opt-in, not auto-detect.** Auto-detecting "raw mode" when `typeof value === "string"` would behavior-switch the cookie API silently based on input type — a subtle footgun. Explicit flag is honest. Tradeoff: slightly more verbose for the "I want a plain-string cookie" case; mitigated by the new `CookieOptions` type being exported alongside.

**Round-trip note.** Reader-side `request.cookie(name)` tries `JSON.parse` first and falls back to the raw string on parse failure, so a `raw: true` write reads back as a plain string with zero extra config.

### 3. `isSending` field removed

Declared on Response (line 88), never read anywhere. Pure dead state. Dropped.

### 4. IP-reading story documented (no rename)

`request.ip` is the immediate-peer address Fastify reports (with `trustProxy` applied). `request.detectIp()` adds `X-Real-IP` / `X-Forwarded-For` resolution on top. Both stayed because each is legitimate; what was missing was the guidance.

- `request.ip` JSDoc now says: "Use when you specifically need the peer address (rate-limit-by-direct-connection, health-check origin verification). For most use cases prefer `detectIp()` — behind any proxy, `ip` reports the proxy, not the real client."
- `request.detectIp()` JSDoc now says: "Best-effort real client IP. Prefer this for any caller behind a proxy. Only trust the result as far as you trust the upstream proxy chain — `X-Forwarded-For` is client-settable; verify the request came through your trusted edge before treating the value as authoritative."

Same guidance as a gotcha in `write-middleware/SKILL.md`.

### 5. Framework orchestration methods marked `@internal`

`runMiddleware`, `getHandler`, `execute`, `executeMiddleware`, `collectMiddlewares` all gained `@internal` JSDoc tags. TypeScript doesn't enforce, but signals "framework orchestration — do not call from app code." Sets up Phase G (extracting these into a `ControllerDispatcher`) with explicit notice that consumers reaching here are doing something unsupported.

### Files touched

- `@warlock.js/core/src/http/response.ts` — `isSending` removed; `CookieOptions` exported; `cookie()` extended; `baseResponse` JSDoc rewritten.
- `@warlock.js/core/src/http/request.ts` — `baseRequest` JSDoc rewritten; `ip` / `detectIp()` JSDoc rewritten; five orchestration methods marked `@internal`.
- `@warlock.js/core/skills/send-response/SKILL.md` — cookies section shows both wrapped + raw patterns.
- `@warlock.js/core/skills/write-middleware/SKILL.md` — two new gotcha bullets.

**Note on this entry's date.** Phase B was first applied on 2026-05-25 but the changes were lost when an interleaving workspace reorg reset the working tree before commit. Re-applied 2026-05-29; functionally unchanged from the original Phase B work.

**Plan:** [`2026-05-25-request-response-cleanups.md`](../plans/2026-05-25-request-response-cleanups.md) (Phase B).

---

## 2026-05-25 — Response: `replay()` helper + double-send guard + content-type preservation

**Decided** as Phase A of the Request/Response cleanups plan ([`2026-05-25-request-response-cleanups.md`](../plans/2026-05-25-request-response-cleanups.md)). Three small, related Response changes that ship together because they share root-cause DNA with the cache middleware bug surfaced in the senior review.

### 1. `Response.replay(cached)` helper

New public method. Takes `{ status, body, contentType?, headers? }` — sets the status, content-type, and extra headers, then calls `send(body)` so the full event lifecycle (`sent`, `success`, status-specific) still fires.

**Why a dedicated helper.** Both `idempotency` and the upcoming cache rewrite hand-roll the same "restore status + restore content-type + send body" sequence on cache HIT. Today's idempotency code did it via `response.baseResponse.status() + response.baseResponse.send()` — which is the same FastifyReply-return bug the cache middleware has (framework re-enters `Response.send` with the FastifyReply as the body; Fastify silently no-ops the second send, hiding it). One helper, one correct implementation, both consumers converge.

### 2. `Response.send()` double-send guard

If `this.baseResponse.sent === true` at entry, log at `error` level (`log.error("response", "send", ...)`) and early-return. Doesn't throw.

**Why warn, not throw.** Production traffic shouldn't crash on a defensive check; the error-level log surfaces the misuse in any sane log pipeline. Tests and dev catch the bug loudly; prod degrades gracefully (one cached response goes through; the spurious second send is a no-op). If a stricter contract is later wanted, escalating to throw is a one-line change.

**Why now.** Without this guard, the exact class of bug we found in cache (and now in idempotency) would silently recur in any future cache-pattern middleware. One defensive check protects every future consumer.

### 3. `Response.send()` respects explicit Content-Type

The auto `application/json` assignment for object bodies (line ~334 in `response.ts`) now skips when `baseResponse.getHeader("Content-Type")` is already set.

**Why.** Discovered while drafting replay tests: `replay({ contentType: "application/vnd.api+json", body: {...} })` was silently downgraded to `application/json` because `send()` unconditionally overrode. Required for replay's contract to hold. Non-breaking — existing callers that didn't explicitly set Content-Type still get the auto JSON.

**Side benefit.** Consumers writing RFC 7807 problem responses (`application/problem+json`), JSON:API responses (`application/vnd.api+json`), or any custom MIME type with an object body now get the right Content-Type instead of being silently overridden. This was always the framework's intended behavior; the unconditional assignment was a bug.

### What didn't ship: tests

The vitest setup in `@warlock.js/core` doesn't resolve workspace siblings (`@warlock.js/fs`, `@warlock.js/context`, etc.) that `response.ts` transitively pulls in. Test infrastructure for the HTTP layer needs a one-time alias setup in `vitest.config.ts` (~10 lines mapping `@warlock.js/<pkg>` → `../<pkg>/src/index.ts`). Deferred to the cache overhaul PR so cache replay can ship with real coverage instead of being mock-bombed individually.

### Files touched

- `@warlock.js/core/src/http/response.ts` — `replay()`, double-send guard, content-type fix
- `@warlock.js/core/src/http/middleware/idempotency.middleware.ts` — HIT path migrated to `replay()`; `CachedResponse` extended with `contentType?: string`; `onSent` captures the content-type via `sentResponse.contentType`

**Typecheck:** clean for `@warlock.js/core` and `@warlock.js/auth`.

**Plan:** [`2026-05-25-request-response-cleanups.md`](../plans/2026-05-25-request-response-cleanups.md) (Phase A).

---

## 2026-05-24 — HTTP middleware: skill split + translation keys flattened

**Decided two follow-up calls after the namespace + helper landings:**

### 1. Split `write-middleware` skill into two

`write-middleware` now focuses on **authoring** custom middleware (function shape, short-circuit semantics, enrichment pattern, registration scopes, common author-side gotchas). A new sibling skill **`use-middleware`** owns the **built-in suite**: catalog, per-primitive deep-dives (`rateLimit` vs `concurrencyLimit`, `idempotency` ordering, `maxBodySize` vs global `bodyLimit`, `maintenance` config flag, `ipFilter` fail-closed, `cache`), composed example, `X-Request-Id` correlation behavior, and built-in-specific gotchas (idempotency-after-auth, in-process counters, bare names not exported).

**Why split:** two different agent intents. "I want to write a middleware that does X" vs "I want to add rate-limit / idempotency / cache to this route". Mixing both in `write-middleware` was muddying the trigger.

**Naming:** chose `use-middleware` over `predefined-middleware` to match the existing `use-X` skill convention (`use-cache`, `use-repository`, `use-app-context`) for "consume a framework primitive via its namespace".

**Request ID correlation lives in `use-middleware`** even though it isn't a middleware — pedagogically it answers the natural follow-up question developers ask while reading the middleware catalog ("wait, do I need a request-id middleware?"). A standalone skill would have been ~30 lines and orphaned.

### 2. Flatten i18n keys: `http.errors.X` → `http.X`

The seven built-in middlewares originally used `t("http.errors.rateLimitExceeded")` etc. Renamed to `t("http.rateLimitExceeded")` to match the **validation group convention** in `src/app/shared/utils/locales.ts`: keys are flat under their group, never nested. `validation.required`, `validation.maxLength`, ... → `http.rateLimitExceeded`, `http.bodyTooLarge`, ...

Updated the `create-warlock` template (`@warlock.js/create-warlock/templates/warlock/src/app/shared/utils/locales.ts`) to ship the `http` group as a sibling to `validation`, with en/ar translations for all seven keys. The current project's own `locales.ts` was not touched — separate decision if Hasan wants the dev instance updated too.

**Plan:** [`2026-05-24-http-middleware-suite.md`](../plans/2026-05-24-http-middleware-suite.md)

---

## 2026-05-24 — HTTP middleware: public API surfaces a `middleware` namespace object

**Decided:** The seven built-in HTTP middleware factories are exported from `@warlock.js/core` as properties on a single `middleware` namespace object (`middleware.rateLimit`, `middleware.concurrencyLimit`, `middleware.maxBodySize`, `middleware.idempotency`, `middleware.maintenance`, `middleware.ipFilter`, `middleware.cache`). The internal factory functions keep the `*Middleware` suffix (`rateLimitMiddleware`, etc.) for in-package code organization; **bare names are not exported**.

**Why the namespace, not bare exports**

- **Discoverability.** Typing `middleware.` triggers autocomplete listing the whole built-in suite. Single entry point to learn from.
- **Extensibility.** Adding a new built-in middleware = adding a property to the namespace; consumers see it appear in autocomplete next update.
- **Self-documenting at call site.** `middleware.rateLimit({...})` is unambiguous as a framework-built-in.
- **No collision with config keys.** Bare `rateLimit` collides cognitively with `http.rateLimit`, `RouteOptions.rateLimit`. Bare `idempotency` collides with `http.idempotency`. Bare `maintenance` collides with `http.maintenance`. The namespace dereference breaks the tie.

**Why the `Middleware` suffix on the internal names**

- Within the package, files like `rate-limit.middleware.ts` export `rateLimitMiddleware`. The suffix disambiguates the function from the noun-phrase concept ("rate limit") in surrounding prose / variable names. Consistent with `cacheMiddleware` (the only pre-existing built-in).
- The suffix is **never visible** in the public API. Users reach for `middleware.rateLimit`, not `rateLimitMiddleware`.

**Why we accept the `middleware: [middleware.X(...)]` collision**

- The exported `middleware` object and `RouteOptions.middleware` array property share a name. On first read this looks confusing.
- In practice the syntactic position differentiates them — `middleware:` is always property assignment, `middleware.X` is always namespace dereference. Express survives `express.use(express.static())` for the same reason.
- Backup name considered: `httpMiddleware`. Rejected — more verbose at every call site for a tradeoff that disappears after the reader has seen the pattern once.

**`authMiddleware` from `@warlock.js/auth` stays top-level**

- The namespace pattern applies to **framework built-ins** shipped from `@warlock.js/core`. Package-shipped primitives (one package, one concern) stay at their package's top level. `authMiddleware` from `@warlock.js/auth` does not get retroactively folded into a namespace.
- If `@warlock.js/auth` later grows into a multi-primitive package, it can ship its own `auth` namespace — but that's a separate package-scoped decision, not a framework-wide convention.

**`cacheMiddleware` renamed to `middleware.cache`, no deprecation alias**

- The framework is pre-1.0. `cacheMiddleware` had no external consumers (grep-verified before rename). Clean rename in the same cycle was cheaper than carrying a `@deprecated` alias indefinitely.
- The internal function inside `cache-response-middleware.ts` keeps the name `cacheMiddleware` — it's the namespace property that points at it that's named `cache`.

**Scope exclusions**

- Re-folding `authMiddleware` into a namespace — deferred indefinitely; out of scope.
- Renaming the existing `cache-response-middleware.ts` file to `cache.middleware.ts` for filename consistency — deferred (cosmetic; high git-churn).
- Adding more middleware to the namespace beyond the initial seven — additive change, no decision needed.

**Plan:** [`2026-05-24-http-middleware-suite.md`](../plans/2026-05-24-http-middleware-suite.md)

---

## 2026-05-24 — HTTP middleware suite: primitives + semantics

**Decided:** Ship seven HTTP middleware primitives from `@warlock.js/core` as factory functions: `rateLimit`, `concurrencyLimit`, `maxBodySize`, `idempotency`, `maintenance`, `ipFilter`, plus `cacheMiddleware` (pre-existing). Request-ID correlation is built into `Request.setRequest()` + `createRequestStore()`, not a separate middleware.

**Why these specific primitives**

- Each addresses an observed risk class the framework couldn't previously close without per-app glue: per-route rate-limit caps (login/OTP), per-route memory cap (200 GB global default is a footgun), in-flight concurrency cap (AI/report endpoints), retry deduplication (AI calls cost real money on duplicate runs), planned downtime (503 toggle), and per-IP gating (admin/webhooks).
- Request-ID echo closes the "support can't grep for a request" gap that existed despite `request.id` already being generated.

**Why no "throttle" primitive**

- "Throttle" overloads (a) rate-limit-with-delay and (b) concurrency cap. (a) is already achievable via `@fastify/rate-limit` tuning. (b) is now `concurrencyLimit()`. The word is ambiguous in JS land — preferring explicit names.

**Why concurrency overflow is 429-reject, not queue**

- In-memory queues are unbounded under load, lost on restart, and add latency. Fast 429 + `Retry-After: 1` is honest backpressure. Clients with retry logic recover; clients without never had a chance with a queue either.

**Why idempotency is scoped per-user (auth → IP fallback)**

- A naked per-key scope lets user A replay user B's key. Scoping by `{userType}:{userId|ip}:{key}` prevents that while still letting the primitive work on public endpoints.
- This requires `idempotency()` to run **after** `authMiddleware`. Documented in the skill + middleware guide; enforced by reading `request.user` / `request.decodedAccessToken` which `authMiddleware` populates.

**Why idempotency conflict returns 422 (not 409)**

- Same key + different body = client bug, not a state conflict. 422 (Unprocessable Entity) signals "request is well-formed but semantically wrong". Matches RFC draft-ietf-httpapi-idempotency-key and Stripe's spec.

**Why we cache successful AND 4xx idempotency responses, but not 5xx**

- 5xx is non-deterministic (transient failure). Clients should retry past one. 4xx is a deterministic outcome of the request — caching it means a malformed retry won't reach the handler twice.

**Why `ipFilter` is fail-closed on missing IP**

- Empty / unparseable `request.ip` is an edge case (Unix socket, internal call, broken proxy). Defaulting to "deny" is safer than "allow" — operators must explicitly add internal callers to the allowlist.

**Why counters (`rateLimit`, `concurrencyLimit`) are in-process**

- Avoids forcing a cache dependency on the simplest deployments (single-replica services don't need distributed counters). With N replicas the effective cap is N × value — documented explicitly in skill + middleware docs.
- Distributed variants are deferred; the swap-in is a `@warlock.js/cache` lock-or-counter call wrapped behind the same factory signature.

**Why `bodyLimit` global default stays at 200 GB**

- Lowering it is a breaking change for any consumer relying on it for non-multipart large bodies. Decision: keep historical default, expose `http.bodyLimit` for opt-in lowering, ship `maxBodySize()` middleware as the per-route surface. Revisit in a future major.

**Why request-id is inherit + echo (hybrid), not server-only**

- Pure server-only loses upstream proxy / FE-generated correlation IDs. Pure client-supplied requires every client to know to send one. Inherit-when-present + echo-always is the industry pattern (AWS ALB, GCP LB, Stripe, Vercel) and supports both worlds.
- Inherited values are length-capped (128) + printable-ASCII validated to prevent log-injection.

**Scope exclusions**

- Distributed counter store for `rateLimit` / `concurrencyLimit` — deferred. Out of scope here.
- Runtime-mutable maintenance toggle (config hot-reload) — deferred; needs a primitive the framework doesn't have yet. Today: config flag + restart.
- IPv6 CIDR matching — out of scope. Exact IPv6 match works; CIDR is IPv4-only. Add IPv6 CIDR if a real use case appears.
- Unit tests — deferred to a follow-up commit.

**Files**

- New: `@warlock.js/core/src/http/error-codes.ts`, six `*.middleware.ts` under `src/http/middleware/`, three helpers under `src/http/middleware/utils/`.
- Edits: `http/types.ts`, `http/server.ts`, `http/request.ts`, `http/middleware/inject-request-context.ts`, `http/index.ts`, `http/middleware/index.ts`, `skills/write-middleware/SKILL.md`, `domains/core/docs/guides/middleware.md`, `domains/core/docs/recipes/rate-limiting.md`.

**Plan:** [`2026-05-24-http-middleware-suite.md`](../plans/2026-05-24-http-middleware-suite.md)

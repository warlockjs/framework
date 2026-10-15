# 2026-05-12 — Per-request relation query cache (opt-in)

**Status:** deferred (no real consumer driving it; revisit when a perf complaint surfaces)
**Severity:** S4 (Low)
**Estimated effort:** 1 day
**Context:** Audit findings 2026-05-12. Same `with("posts")` re-fires per call within a single request.

## Why

```ts
// Inside a single HTTP request
const users = await User.query().with("posts").get();
const adminUsers = await User.query().where("role", "admin").with("posts").get();
// posts gets re-queried for the admin subset even though some IDs overlap
```

Most apps don't notice. High-traffic paths with denormalised dashboards or N reports per request do — relation queries become a measurable share of latency.

Today: no caching. Each `with()` invocation hits the DB fresh.

## Scope

**In:** Opt-in, per-request cache keyed by `(model, FK-values, constraint hash)`. Returns cached related models when the same query repeats within the request.

**Out:** Default-on caching (correctness risk). Cross-request caching (separate problem, Redis-shaped). Cache for `joinWith` / `withCount` results (those are baked into the main row; not a separate query).

## Tasks

- [ ] Define request-scope storage. Two options:
  - **(a)** WeakMap keyed by a request-context object (caller passes the context)
  - **(b)** AsyncLocalStorage (Node's per-async-execution state)
- [ ] Add a `.cached()` builder method to opt in
- [ ] Compute cache key: `${modelName}:${sortedFkValues.join(",")}:${hashConstraintOps(constraintOps)}`
- [ ] Wrap `RelationLoader.loadHasMany` / `loadHasOne` / `loadBelongsTo` / `loadBelongsToMany` to check the cache before issuing the query
- [ ] On cache hit: skip the query, deep-clone the cached records (so mutations don't pollute cache)
- [ ] On cache miss: run the query, store the result, return
- [ ] Document: explicit opt-in only; no cross-request sharing; clone-on-read to prevent state leak
- [ ] Demo + verify with logged query count before/after
- [ ] Type-check

## Key implementation notes

### Why opt-in not default

Caching can mask staleness bugs — a write happens, a read happens later in the same request, the read returns stale data. Defaulting to cached makes that a footgun. Opt-in says "I know this scope is read-only, please cache."

### Per-request scope only

Cross-request would need a real cache layer (Redis) and invalidation discipline. Out of scope.

### Cloning on read

Cached records returned by reference would share state across callsites. If one caller mutates `user.posts[0].title`, the next caller sees the mutation. Clone-on-read prevents this — at the cost of memory.

Alternative: freeze cached records (read-only). Cheaper than cloning but breaks any code that mutates them. Pick clone for correctness; document the memory cost.

### Cache key hashing

`hashConstraintOps(ops)` needs a deterministic serialisation of the constraint callback's recorded ops. Existing `JSON.stringify` works for the data fields but functions in op data can't serialise. The constraint callback's output is already an `Op[]` of plain data, so this should be safe.

### AsyncLocalStorage vs explicit context

ALS is magic — wires the cache through async boundaries without ceremony. Explicit context is more honest about scope. Recommend ALS for ergonomics; document.

## Decisions to lock

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Opt-in via `.cached()` or auto-on within a context? | **`.cached()` opt-in.** Avoids surprise staleness. |
| 2 | AsyncLocalStorage or explicit context object? | **ALS.** Better DX; explicit context can come later if anyone wants strict scoping. |
| 3 | Clone or freeze cached records? | **Clone.** Correctness over memory. |
| 4 | Include constraint hash in key? | **Yes.** Same relation, different filter — different cache entries. |
| 5 | Invalidate on writes within the same request? | **No.** Per-request cache is short-lived; if you mutate then read with cached, you opted into that. |

## Verification

- [ ] Demo: same query twice in one request, second one hits cache (log count)
- [ ] Different constraint = different cache entry
- [ ] Cross-request: second request always misses (fresh start)
- [ ] Mutation on cached record doesn't affect the next consumer's read
- [ ] tsc clean

## Investigation note — 2026-05-12

Deferred. Three reasons:

1. **No real consumer.** The audit didn't surface any code path in `src/app/**` repeatedly hitting the same relation in one request. The value is hypothetical.
2. **Genuine 1-day scope.** ALS plumbing, cache key serialisation (constraint ops hashing), clone-vs-freeze decision, invalidation policy. Each has tradeoffs needing real-context decisions.
3. **YAGNI risk.** Per-request caching can mask staleness bugs — opting in is the right default, but the gain is small if nobody's complaining about latency.

Revisit when: (a) a measurable hot path emerges, OR (b) a use case specifically benefits from request-scoped relation memoisation (e.g. denormalised dashboards firing the same `.with("metrics")` from N report builders).

## Summary

_Deferred — see investigation note above._

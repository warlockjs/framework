# 2026-05-12 — Relation lifecycle events

**Status:** deferred (design decision needed before implementation)
**Severity:** S4 (Low)
**Estimated effort:** 1 day (revised from 0.5d after investigation)
**Context:** Audit findings 2026-05-12. Useful for cache warming, audit, conditional override.

## Why

Cascade has model-level lifecycle events (`creating`, `created`, `updating`, etc.) but no relation-loading events. Use cases that this would unlock:

- **Cache warming.** Listener primes a Redis key when posts are loaded for a user.
- **Audit logging.** Track which relations were accessed in which request (security/compliance).
- **Conditional override.** Listener mutates the loaded set based on user permissions before the caller sees them (e.g. filter restricted posts).

Today: zero hooks. Adding them costs little.

## Scope

**In:** Three event names per relation: `relations.<name>.loading`, `relations.<name>.loaded`, `relations.<name>.attached`. Wire emission into `RelationLoader`. Document the contract.

**Out:** A whole eventing redesign. Per-instance event scoping (use existing `Model.events` infrastructure).

## Tasks

- [ ] Define event names + payloads:
  - `relations.<name>.loading` — fired before the related-model query runs. Payload: `{ models: TModel[], relationName, definition, queryBuilder }`
  - `relations.<name>.loaded` — fired after the query returns, before attachment. Payload: `{ models, relationName, relatedRecords }`
  - `relations.<name>.attached` — fired after attachment to model instances. Payload: `{ models, relationName }`
- [ ] Hook into [`RelationLoader.loadHasMany`](../../../@warlock.js/cascade/src/relations/relation-loader.ts:185), `loadHasOne`, `loadBelongsTo`, `loadBelongsToMany` — emit each event at the right moment
- [ ] Hook into the morph / through loaders once those land
- [ ] Add an opt-out: `query.silentRelations()` flag that skips emission (useful inside scope callbacks to avoid recursion)
- [ ] Document via JSDoc in `relation-loader.ts`
- [ ] Type-check

## Key implementation notes

### Why three events not one

`loading` lets a listener mutate the query (add scopes). `loaded` lets a listener filter/transform the raw records. `attached` lets a listener cache or audit AFTER models have their `.posts` populated.

Most users only need `attached`. The other two exist for power users.

### Event scoping — per-model class

Use existing `Model.events()` infrastructure on the **calling** model class (the one that owns the `with()` call). Listeners register via:

```ts
User.events().on("relations.posts.attached", ({ models }) => { ... });
```

### Recursion risk

A listener that triggers another `with()` on the same relation could loop. Document the `silentRelations()` opt-out for use inside scope/listener callbacks.

### Backward-compat

Purely additive. Existing code unaffected.

## Decisions to lock

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Three events per relation or one? | **Three.** Different use cases need different timing; cheap to wire. |
| 2 | Per-relation event names or one event with relation in payload? | **Per-relation names.** Lets listeners subscribe selectively; reduces filter logic in listeners. |
| 3 | Default-off or always emit? | **Always emit.** No-op if no listeners. Cost is negligible. |
| 4 | Recursion guard built in? | **No, just an opt-out.** Listeners that cause recursion own the bug. |

## Verification

- [ ] Demo: listener on `relations.users.attached` logs the count
- [ ] `silentRelations()` skips emission
- [ ] tsc clean

## Investigation note — 2026-05-12

The plan assumed reuse of the existing `Model.events()` infrastructure. After reading [`events/model-events.ts`](../../../@warlock.js/cascade/src/events/model-events.ts), the existing `ModelEventName` is a fixed union (`"initializing" | "fetching" | "hydrating" | ...`) — does NOT accept arbitrary strings, and the `ModelEvents` class types its listeners Map keyed to that union.

Per-relation event names (`relations.posts.loaded`, `relations.tags.attached`) require one of:

1. **Extend `ModelEventName`** with `relations:loading | relations:loaded | relations:attached`. Loses per-relation discrimination — every listener gets every relation's events and has to filter by `context.relationName`. Cheap but high friction for consumers.
2. **Loosen `ModelEventName` to `ModelEventName | (string & {})`**. Allows arbitrary strings while keeping autocomplete for known ones. Breaks the strict-typing contract of existing model event consumers. Intrusive.
3. **Build a separate `RelationEvents` emitter** on Model. New API surface (`Model.relationEvents().on(...)`), different from `Model.events()`. Cleaner separation, more code. Likely the right design but more than half a day.

Option 3 is the proper move, but it pairs naturally with type-safe relation names (which would let `relationEvents().on("posts.loaded", ...)` be type-checked against the model's declared relations). Until that lands, any of these designs are half-finished.

**Decision:** defer until type-safe relation names work resumes. Both plans share the same type-level groundwork (template-literal event names matching declared relations).

## Summary

_Deferred — see investigation note above._

# 2026-05-12 — Defer relation-model resolution with clearer errors

**Status:** partial (error message + startup verification done; defer-resolution proxy still open)
**Severity:** S4 (Low)
**Estimated effort:** 0.5 day
**Context:** Audit findings 2026-05-12. Circular imports between models can return `undefined` from the registry mid-load.

## Why

[`getModelFromRegistry(name)`](../../../@warlock.js/cascade/src/relations/relation-loader.ts:471-482) returns `undefined` if the named model hasn't yet been decorated with `@RegisterModel()`. This happens when:

- Two models reference each other via string names
- Module A imports Module B which imports Module A (TS allows; runtime ordering depends on how the bundler / Node ESM loader resolves)
- The decorator on the second-loaded model hasn't fired by the time the first model's relation is consulted

Failure mode: deep inside a query, `Relation model "Tag" not found in registry`. Stack trace points to the loader, not to the import-cycle root cause. Devs hunt for missing imports.

## Scope

**In:** Better error message at the failure site. Optional defer-resolution helper that retries once. Document the import-order best practice.

**Out:** Async model resolution (changes every consumer). Auto-discovery via filesystem glob (out of charter).

## Tasks

- [ ] Improve error message in `resolveModelClass`:
  - Include the calling model class name (caller context)
  - Include the relation name being resolved
  - Suggest the likely root cause (circular import, missing `@RegisterModel`, missing top-level import)
  - Link to docs once the docs page exists
- [ ] Add an optional `getModelFromRegistry(name, { defer?: boolean })` overload:
  - When `defer: true`, returns a `Proxy` or thunk that resolves on first use
  - Useful for relation defs declared inside class bodies that load before the related model
- [ ] Document the import-order best practice in a top-level README or skill doc once `domains/cascade/skills/` exists
- [ ] Consider: a startup verification pass — after all `@RegisterModel` decorators have fired, walk every model's `relations` and verify all named targets resolve. Fail-fast at boot rather than at query time. (Add as a sub-task.)
- [ ] Type-check

## Key implementation notes

### Why not always defer

Deferred resolution adds proxy overhead per query. For the common case (no circular imports), the existing direct lookup is correct and fast. Defer should be opt-in for the cases that actually need it.

### Startup verification pass

After app bootstrap (every `@RegisterModel` fired), iterate registered models and call `getModelFromRegistry` for every relation target. If any returns undefined, throw with a clear "Model X has relation Y → Z, but Z is not registered. Did you forget an import?".

This is a one-time O(M×R) cost at startup — invisible at runtime, catches every misconfiguration before the first query.

### Better error message template

```
Model "Tag" not found in registry while resolving relation "tags" on "Post".

Common causes:
  - Tag is not decorated with @RegisterModel()
  - Tag is in a module that hasn't been imported at app startup
  - Circular import: Tag imports Post, Post imports Tag — one of them
    sees the other as undefined during load

Add `import "<path-to-tag-model>";` to your app's entry point to ensure
the model is registered before queries run.
```

## Decisions to lock

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Add deferred-resolution mode? | **Yes, opt-in.** Useful escape hatch for genuine circular cases. |
| 2 | Add startup verification pass? | **Yes.** O(M×R) once at boot; catches every typo / missing import. |
| 3 | Where does verification fire — in `Model.bootstrap()` or first `query()` call? | **App bootstrap.** Earlier failure = better signal. |
| 4 | Throw or warn on verification failure? | **Throw.** Continuing with broken relations silently is worse than failing fast. |

## Summary (partial — 2026-05-12)

**Landed:**
- `RelationLoader.resolveModelClass` now throws with caller context (which model + which relation triggered the resolution) and lists common causes (missing `@RegisterModel`, missing import, circular import) with a concrete fix suggestion.
- New exported `verifyRegisteredRelations()` function in `register-model.ts`. Walks every registered model, checks every relation's string `model` target resolves in the registry, throws a single error listing all failures with the `caller.relation → target` format. Designed to be called once at app bootstrap after all model modules have loaded.
- `verifyRegisteredRelations` is auto-exported via the existing `index.ts` barrel.

**Deferred:**
- `getModelFromRegistry(name, { defer: true })` overload returning a lazy thunk/Proxy. Useful escape hatch for genuine circular cases but adds API surface; consumers haven't requested it. Revisit if a real case appears.

**Recommended usage:**

```typescript
import { verifyRegisteredRelations } from "@warlock.js/cascade";

// In app/bootstrap:
import "./app/users/models/user/user.model";
import "./app/organizations/models/organization/organization.model";
// ... all model imports

verifyRegisteredRelations(); // throws clearly at boot if anything is missing
```

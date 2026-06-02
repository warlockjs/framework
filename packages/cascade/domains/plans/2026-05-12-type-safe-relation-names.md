# 2026-05-12 — Type-safe relation names via inference from `static relations`

**Status:** partial (groundwork landed 2026-05-12, full literal-key validation deferred to focused session)
**Severity:** S3 (Medium)
**Estimated effort:** 1 day (remaining)
**Context:** Audit findings 2026-05-12. Modern ORMs (Drizzle, Prisma) get this right; Cascade leaves it on the table.

## Why

```ts
const user = await User.query().with("postss").get();
// ↑ typo, compiles fine, fails at runtime
```

The `static relations: Record<string, any>` declaration in [`Model`](../../../@warlock.js/cascade/src/model/model.ts:493) widens away the literal keys. `with("postss")` passes typecheck because `string` accepts anything.

Same problem for `joinWith`, `withCount`, `load`. All silently accept any string at compile time.

DX win is real: typo prevention, autocomplete on relation names, refactor safety (rename a relation → all callsites flagged).

## Scope

**In:** Type-only refactor. Constrain `with` / `joinWith` / `withCount` / `load` to accept relation names declared on the calling model.

**Out:** Runtime change (none needed). Inferring constraint-callback parameter type from the related model (separate, larger plan). Validating every segment of dot-notation paths (`posts.comments.author`) — too aggressive; validate first segment only.

## Tasks

- [ ] Refactor `Model.relations` type from `Record<string, any>` to a generic that preserves keys:
  ```ts
  static relations: Readonly<Record<string, RelationDefinition>> = {};
  ```
  Combined with `as const` at the model declaration site to preserve literal keys.
- [ ] Add a `RelationNames<TModel>` type helper:
  ```ts
  type RelationNames<TModel> =
    TModel extends { relations: infer R }
      ? keyof R & string
      : string;
  ```
- [ ] Constrain `with`/`joinWith`/`withCount`/`load` overloads to accept `RelationNames<this> | NestedRelationName<this>` (dot-notation: `${RelationNames<this>}.${string}`)
- [ ] Update [`Model.with`](../../../@warlock.js/cascade/src/model/model.ts:1305) static overloads
- [ ] Update [`QueryBuilderContract`](../../../@warlock.js/cascade/src/contracts/query-builder.contract.ts:1202) `with`/`joinWith`/`withCount` overloads to be generic in the calling model
- [ ] Update `Model.load` instance method
- [ ] Verify by introducing a typo in a demo callsite and confirming TS catches it
- [ ] Verify autocomplete works in editors (IDE smoke test)
- [ ] Run full repo `tsc --noEmit` — fix any pre-existing typos surfaced by the new type discipline

## Key implementation notes

### `as const` requirement

For TS to preserve literal keys on a record, the model needs:

```ts
class User extends Model {
  static relations = {
    posts: hasMany("Post"),
    profile: hasOne("Profile"),
  } as const satisfies Record<string, RelationDefinition>;
}
```

This is a small ceremony cost. Document it.

### Fallback for models without typed relations

If `static relations` is not declared, fall back to `string`:

```ts
type RelationNames<TModel> =
  TModel extends { relations: infer R }
    ? R extends Record<string, RelationDefinition>
      ? keyof R & string
      : string
    : string;
```

Don't break existing models that haven't migrated to `as const`.

### Nested dot-notation

`with("posts.comments.author")` validating every segment requires recursive type lookup across model classes — too aggressive for v1. Validate only the first segment:

```ts
type NestedRelationName<TModel> = `${RelationNames<TModel>}.${string}`;
```

Catches typos in the entry point (most common). Mistakes deeper in the chain still fail at runtime — acceptable.

### Constraint callback param types

Bonus: `with("posts", q => ...)` — `q` is currently `QueryBuilderContract<unknown>`. Could be inferred to `QueryBuilderContract<Post>` if relations carry their model type. **Defer**; bigger refactor than this plan.

## Decisions to lock

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Require `as const` on relation declarations? | **Yes — opt-in.** Without it, fall back to `string`. Backward compat. |
| 2 | Validate dot-notation paths recursively? | **First segment only.** Recursive validation is too complex for v1. |
| 3 | Infer constraint callback's QB generic type? | **Defer to v2.** Bigger refactor. |
| 4 | Where does `RelationNames` live? | **`relations/types.ts`.** Co-locates with `RelationDefinition`. |

## Verification

- [ ] Demo: induce a typo (`with("postss")`) on a model declared with `as const` — TS error surfaces
- [ ] Demo: existing model without `as const` still works (string accepted)
- [ ] Autocomplete works in IDE
- [ ] Full `tsc --noEmit` clean across the repo

## Summary (partial — 2026-05-12)

**Landed:** `Model.relations` static field narrowed from `Record<string, any>` to `Readonly<Record<string, RelationDefinition>>`. Improves IDE intellisense on relation definitions and locks the value shape. Verified clean across the entire repo — every existing model already declares relations with `belongsTo`/`hasMany`/`hasOne`/`belongsToMany` factories that return `RelationDefinition`, so the tighter type satisfies them all.

**Deferred:** Full literal-key validation requires:

1. Every model to declare `static relations = { ... } as const satisfies Record<string, RelationDefinition>` for TS to preserve the literal keys
2. A generic constructor type that captures the literal `relations` shape (currently `ChildModel<TModel>` Picks from `typeof Model` which is widened away)
3. `RelationName<TModel>` helper using template-literal types for first-segment dot-notation validation
4. Updated overloads on `with` / `joinWith` / `withCount` / `load` / `has` / `whereHas` / etc.

This needs a focused session because:
- Every overload signature in the contract + model + query-builder needs careful refactor
- `ChildModel<TModel>` generic plumbing is touched by every static factory method
- Likely to surface pre-existing typos in `src/app/**` that will need fixing
- High blast radius if a subtle generic signature breaks contract conformance

Doing it as part of a 7-plan sprint risks half-baked output. Promoted to its own focused-session plan.

**Path forward when revisited:** start with `RelationName<TModel>` type helper in `relations/types.ts`, write a small spike with one model declared `as const`, prove the constraint works on `with()`, then propagate. Avoid breaking existing models that haven't opted in via `as const` — type should fall back to `string` when `relations` widens.

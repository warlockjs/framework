# 2026-05-12 — Carry `.nullable()`, `.default()`, and `.nullish()` through `Infer<>`

**Status:** completed 2026-05-12 — shipped in commit `fdc5ce6`. Scope expanded mid-implementation to add the `Infer.Input` / `Infer.Output` namespace and flip bare `Infer<T>` semantics.
**Severity:** S2 (High DX) — users get types that lie about runtime shape; not crashing, just wrong
**Estimated effort:** 1 day — actual: ~3 hours (scope expansion added another ~1 hour for namespace work and Cascade/core migration)
**Started:** 2026-05-12
**Context:** Surfaced during competitive-positioning audit on 2026-05-12. See [`domains/seal/design/competitive-positioning.md` § Weaknesses #1](../design/competitive-positioning.md). Same brand mechanism unlocks `.nullish()` essentially for free.

## Why

`Infer<typeof schema>` walks the validator tree and produces a TS type. Today it gets two things wrong and lacks one piece of sugar:

### Bug 1 — `.nullable()` doesn't widen output

```ts
const schema = v.object({
  deletedAt: v.date().optional().nullable(),
});

type T = Infer<typeof schema>;
// Current:  { deletedAt?: Date }                  ← WRONG, missing null
// Correct:  { deletedAt?: Date | null }
```

At runtime, `validate(schema, { deletedAt: null })` returns `{ deletedAt: null }`. The type lies — TS thinks it's `Date | undefined`. Users either cast or write defensive `if (value !== null)` checks the type told them weren't needed.

### Bug 2 — `.default()` doesn't narrow output

```ts
const schema = v.object({
  status: v.string().optional().default("active"),
});

type T = Infer<typeof schema>;
// Current:  { status?: string | undefined }      ← WRONG, status always present
// Correct:  { status: string }                    ← key required, type narrowed
```

`.default("x")` guarantees that the field is present in `validData` (either the caller's value or the default fires). The type should drop both `undefined` and the `?` optionality. Today it carries both, forcing users to `?? "active"` everywhere.

### Sugar — `.nullish()` doesn't exist

`.optional().nullable()` is a common combo (DB column that's both omittable AND nullable). Zod ships `.nullish()` as one-call sugar. Trivial to add once nullable is brand-tracked.

## Root cause

[inference-types.ts:39](../../../@warlock.js/seal/src/types/inference-types.ts:39) — `Infer<>` reads exactly one brand: `{ isOptional: true }`. The validator class carries `isNullable` as a runtime boolean ([base-validator.ts:36](../../../@warlock.js/seal/src/validators/base-validator.ts:36)) and `defaultValue` as a property ([base-validator.ts:29](../../../@warlock.js/seal/src/validators/base-validator.ts:29)) — neither bleeds into the type system. The `.nullable()` and `.default()` methods return `this`, not a branded type.

## Scope

**In:**

- Add `{ isNullable: true }` brand to the return type of `BaseValidator.prototype.nullable()`
- Add `{ hasDefault: true }` brand to the return type of `BaseValidator.prototype.default(value)`
- Add `nullish()` method that combines both (returns `this & { isOptional: true; isNullable: true }`)
- Update `Infer<T>` to read both new brands and apply `| null` / drop-`undefined` accordingly
- Sweep validator factory return type casts (the `as X & StandardSchemaV1<...>` patterns in [factory/validators.ts](../../../@warlock.js/seal/src/factory/validators.ts)) so they don't strip the new brands
- Update Standard Schema bridge to surface the corrected types

**Out:**

- Changing runtime behaviour — only the type-level surface changes
- Adding `.notNullable()` brand tracking (it already exists at runtime but reverting the brand is messy; users who need it can recast)
- Branding the `.optional()` ergonomics already in place

## The fix — sketch

### Brand declarations

```ts
// base-validator.ts (or methods file)
declare module "./base-validator" {
  interface BaseValidator {
    nullable<T extends this>(): T & { isNullable: true };
    notNullable<T extends this>(): T & { isNullable: false };
    default<T extends this, V>(value: V | (() => V)): T & { hasDefault: true };
    nullish<T extends this>(): T & { isOptional: true; isNullable: true };
  }
}
```

### `Infer<>` rewrite (sketch — actual code will need careful conditional ordering)

```ts
type ExtractNullable<T> = T extends { isNullable: true } ? null : never;

type ExtractHasDefault<T> = T extends { hasDefault: true } ? true : false;

export type Infer<T> =
  T extends ObjectValidator<infer S>
    ? {
        // Optional fields: marked .optional() AND no default
        [K in keyof S as
          S[K] extends { isOptional: true }
            ? ExtractHasDefault<S[K]> extends true
              ? never  // has default → required at runtime
              : K
            : never
        ]?: Infer<S[K]> | ExtractNullable<S[K]>;
      } & {
        // Required fields: not optional, OR optional-with-default
        [K in keyof S as
          S[K] extends { isOptional: true }
            ? ExtractHasDefault<S[K]> extends true
              ? K
              : never
            : K
        ]: Infer<S[K]> | ExtractNullable<S[K]>;
      }
    : // ... existing branches with ExtractNullable applied
      // T extends StringValidator ? string | ExtractNullable<T>
      // T extends IntValidator    ? number | ExtractNullable<T>
      // ... etc
      unknown;
```

(The actual implementation will be cleaner — this is intent-level sketch. Mapped-type wizardry may be needed to keep the conditional branches readable.)

### `nullish()` implementation

```ts
BaseValidator.prototype.nullish = function () {
  return this.optional().nullable() as any;
};
```

(Two existing chained calls — the brand intersection comes from the type signature, not runtime work.)

## Tasks

- [ ] Add the four method type declarations to [methods/required-methods.ts](../../../@warlock.js/seal/src/validators/methods/required-methods.ts) (where `.optional()` already lives) or a new `methods/type-brand-methods.ts` if it's cleaner
- [ ] Add `nullish()` implementation alongside `optional()`
- [ ] Update `BaseValidator.prototype.nullable` and `.notNullable` return types in [base-validator.ts:106-119](../../../@warlock.js/seal/src/validators/base-validator.ts:106) (or via `declare module`)
- [ ] Update `BaseValidator.prototype.default` return type in [base-validator.ts:567](../../../@warlock.js/seal/src/validators/base-validator.ts:567)
- [ ] Rewrite `Infer<T>` in [inference-types.ts](../../../@warlock.js/seal/src/types/inference-types.ts) to handle the three new cases
- [ ] Audit factory casts in [factory/validators.ts](../../../@warlock.js/seal/src/factory/validators.ts): every `as XValidator & StandardSchemaV1<Y>` needs to *not* strip the new brands. May need to drop the `as` and use a different declaration style
- [ ] Audit downstream consumers (`cascade` model schemas, `ai` Standard Schema usage) for places where the old `Infer<>` was implicitly relied upon for narrower types — TS errors will surface these
- [ ] Run `tsc --noEmit` across the monorepo
- [ ] Hand-test the four cases below

## Hand-test matrix

```ts
// Case 1: nullable widens
type A = Infer<typeof v.object({ x: v.string().nullable() })>;
// expect: { x: string | null }

// Case 2: default narrows + makes required
type B = Infer<typeof v.object({ x: v.string().optional().default("a") })>;
// expect: { x: string }

// Case 3: nullish = optional + nullable
type C = Infer<typeof v.object({ x: v.string().nullish() })>;
// expect: { x?: string | null }

// Case 4: optional + nullable + default — all three
type D = Infer<typeof v.object({ x: v.string().optional().nullable().default("a") })>;
// expect: { x: string | null }  ← default makes it required, nullable widens

// Case 5: required + nullable (no .optional)
type E = Infer<typeof v.object({ x: v.string().nullable() })>;
// expect: { x: string | null }  ← required key, but value can be null

// Case 6: nullable on nested validators
type F = Infer<typeof v.object({ tags: v.array(v.string()).nullable() })>;
// expect: { tags: string[] | null }
```

## Decisions to lock with Hasan

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Brand via TS-only intersection (no runtime cost) or runtime flag too? | **TS-only intersection.** Runtime `isNullable` boolean already exists; that's the runtime state. The brand is purely for `Infer<>` consumption. Avoids double-bookkeeping. |
| 2 | `.default(v => fn)` (lazy callback) — does it brand `{ hasDefault: true }` too? | **Yes.** Runtime behaviour is identical; the brand reflects "this field will always be present in validData", which is true for both eager and lazy defaults. |
| 3 | When `.notNullable()` is called after `.nullable()`, does the brand revert? | **Yes — type-level too.** Method signature returns `{ isNullable: false }` which TS treats as removing the brand. Cleanly cancels. |
| 4 | Should `.default(undefined)` strip the `{ hasDefault: true }` brand? | **No.** Defaulting to `undefined` is a no-op (`data ?? undefined` is `data`), but the brand reflects intent, not runtime equivalence. If users do this, they get a slightly weird type — it's their tell to remove the call. |
| 5 | Major version bump? | **No (point release).** This widens types in ways that surface previously-hidden bugs in user code; consumers will get new TS errors, but those errors are *uncovering* real issues. Document in changelog as "type-narrowing improvements". |

## Risks

- **Type breakage in consumers.** Cascade/AI code that implicitly assumed `Infer<v.string().nullable()> === string` will now error. Each will need a one-line fix (`as string` cast, or — better — accept the new shape and handle `null`). These errors are *signal*, not regression: they reveal places where the old types were lying.
- **`as X & StandardSchemaV1<Y>` casts in `factory/validators.ts`.** If the cast is too narrow, it strips the new brands and Infer reverts to the old broken output. The audit task above catches this; mitigation is to widen the casts or drop them where possible.
- **`Infer<>` conditional-type complexity.** TS conditional-mapped types are finicky; one wrong distribution and the inference goes broad. Hand-test matrix catches the regressions.

## Skills + docs lockstep

After landing:

- Update `skills/subskills/chaining.md` — replace the current `.nullable()` and `.default()` blurbs with notes on the new brand-aware behaviour. Add `.nullish()` section.
- Update `domains/seal/docs/recipes/optional-fields.md` — the "Quick reference" tables now include nullable AND default columns reflecting actual inference
- Append decision § 3 to `domains/seal/design/decisions.md` — "type-level brand tracking for nullable/default/optional"

## Summary

Landed in commit `fdc5ce6`. Scope expanded from the original "add brands + nullish" to a full `Infer.Input` / `Infer.Output` namespace + bare-Infer-is-Input convention shift after discussion with Hasan on DX framing.

**What shipped.**

- `.nullable()` / `.notNullable()` brand-return `{ isNullable: true/false }`
- `.default(value)` brand-return `{ hasDefault: true }`
- `.nullish()` shipped as sugar method (calls `.optional().nullable()` internally)
- `.catch()` brand-return `{ hasCatch: true }` (added during plan G's work; brands match `hasDefault` for guaranteed-presence semantics)
- New `IsOutputOptionalKey<V>`, `IsInputOptionalKey<V>`, `IsGuaranteed<V>`, `WithNullable<V, T>` helpers
- `InferInputObjectShape<S>` / `InferOutputObjectShape<S>` — both exported for downstream use; `ObjectValidator` parent class parameterised as `BaseValidator<InferInputObjectShape, InferOutputObjectShape>` (correctness fix — input and output were previously the same type)
- Two parallel walkers `Infer.Input<T>` / `Infer.Output<T>` via namespace
- Bare `Infer<T>` aliases `Infer.Input<T>` per the DX framing
- Deprecated flat aliases `InferInput<T>` / `InferOutput<T>` retained for migration

**Decisions locked.**

- #1 (TS-only intersection brands, no runtime double-bookkeeping) — adopted
- #2 (lazy defaults also brand `{ hasDefault: true }`) — adopted
- #3 (`.notNullable()` reverts brand at type level) — adopted
- #5 (no major version bump) — adopted — but added a deprecation path for the flat aliases
- **New decision after Hasan's pushback on Zod convention:** flip bare `Infer<T>` to mean `Infer.Input<T>` and expose namespace shortcuts. Recorded as `domains/seal/design/decisions.md § 7`.

**Migration in adjacent packages.** Done in the same commit:

- `@warlock.js/cascade/src/utils/define-model.ts` — `Model<Infer<...>>` → `Model<Infer.Output<...>>`
- `@warlock.js/core/src/database/models/database-log/database-log.ts` — `Infer<>` → `Infer.Output<>`
- `@warlock.js/core/src/http/database/RequestLog.ts` — same
- `@warlock.js/core/src/cli/commands/generate/templates/stubs.ts` — model-generation templates emit `Infer.Output<>`; request schema templates stay on bare `Infer<>` (now = Input)

App-level Cascade model declarations not in the framework packages may also need migration (one line per model). Documented in `domains/seal/docs/recipes/optional-fields.md`.

**Verification.** `tsc --noEmit -p .` clean across `@warlock.js/seal`, `@warlock.js/cascade`, `@warlock.js/core`. Remaining tsc errors in app-level WIP code (`src/app/channels/`, two seed files) are pre-existing and unrelated.

**Skills + docs.** `SKILL.md`, `chaining.md`, `optional-fields.md` updated with the namespace/Input/Output distinction. See the lockstep commit immediately following `fdc5ce6`.

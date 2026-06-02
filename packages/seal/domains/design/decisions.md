# @warlock.js/seal — Locked Design Decisions

**Status:** Agreed (append-only, newest first)

Decisions taken with reasoning. Use this when a future session wants to "reconsider" something — the reasoning here usually still applies.

---

## 1. Absent optional fields are *omitted* from `validData`, not undefined-valued

**Date.** 2026-05-12

**Decision.** When a field declared `.optional()` is absent from the input payload (or explicitly `undefined`), the parent `ObjectValidator` does **not** include the key in `validData`. The child validator must propagate `data: undefined` for this to work; the parent guards with `if (childResult.data !== undefined && !validator.isOmitted())` before writing the key.

**Why.**

- Distinguishes "caller never touched this field" from "caller intentionally set this field to an empty value". Persistence layers (Mongo, JSON serializers, diff tools) treat these two states differently — `db.find({ field: { $exists: false } })` only matches the first case, and any sensible serializer omits absent keys rather than emitting `field: undefined`.
- Round-tripping. A schema-validated payload should reconstruct the caller's intent. Synthesizing values for fields the caller never mentioned violates that principle.
- Aligns with TypeScript's optional-property model: `{ field?: string }` has `field` as truly absent at runtime, not as `field: undefined`.

**Trade-off.**

- Consumers must use `if ("field" in validData)` (or `validData.field !== undefined`) to detect presence — they can't shortcut with `if (validData.field)` if the field's valid values include falsy ones.
- Distinction is invisible in JSON output (both forms serialize the same when `field: undefined` is dropped by `JSON.stringify`), so the asymmetry only matters in JS-land or when persisting to schemas with sparse-column semantics.

**Where documented.**

- Implementation: `validators/object-validator.ts` — Phase 1 / Phase 2 loop guards each `validatedData[key] = childResult.data` with the `!== undefined` check.
- User-facing: `domains/seal/docs/recipes/optional-fields.md`.
- Skill: `@warlock.js/seal/skills/subskills/chaining.md` § "Absent vs empty".

---

## 2. Collection validators (`record` / `array` / `tuple`) propagate `undefined` for absent input

**Date.** 2026-05-12

**Decision.** `RecordValidator.validate()`, `ArrayValidator.validate()`, and `TupleValidator.validate()` return `{ data: undefined }` when called with `data === undefined` (and no `.default()` fired). They do **not** synthesize empty containers (`{}` / `[]`) for absent input.

**Why.**

- Direct corollary of § 1 — for the parent's omit-absent-keys contract to work, child validators must propagate `undefined`. Three collection validators previously violated this with a `(await this.mutate(data, context)) || {}` (or `|| []`) coercion at the top of `validate()`, which silently materialised an empty container and caused the parent to write the empty value into `validData`.
- Real-world impact: every Cascade model with an optional `record`/`array` field (e.g. `Faq.metadata`, `Faq.embedding`) was persisting empty values to Mongo for records that never supplied them. Defeated `$exists` filters and corrupted analytics on "field populated yet?" queries.
- Symmetry with scalar validators: an absent `v.string().optional()` returns `data: undefined`. There's no good reason for collection validators to behave differently.

**Trade-off.**

- Behaviour change. Anyone who relied on `validData.metadata` being a guaranteed-truthy `{}` after validation has to update to `validData.metadata ?? {}` (or use `.default({})` if they want the old behaviour as opt-in).
- Side benefit: `.default(x)` now actually works on these three validators. It was a silent no-op before, because the override bypassed `BaseValidator.validate()`'s `valueForRules = data ?? this.getDefaultValue()` plumbing.

**Where documented.**

- Plan: `domains/seal/plans/2026-05-12-optional-collection-coercion.md`.
- Implementation: `validators/record-validator.ts`, `array-validator.ts`, `tuple-validator.ts` (mirror `ObjectValidator`'s pattern — apply default → mutate → propagate undefined/null when there's nothing to iterate).
- Tests: `tests/unit/validators/{record,array,tuple}-validator.test.ts` — "optional / nullable / default — absent input handling" describe block.

---

## 3. JSON-Schema-influencing transformers must declare a marker; source-string inspection is forbidden

**Date.** 2026-05-12

**Decision.** When a transformer changes the shape of `toJsonSchema()` output (e.g. `toDateOnly()` → `format: "date"`), it must declare its effect via an explicit marker on the transformer's `options` bag — e.g. `options.__jsonSchemaFormat = "date"`. The validator's `toJsonSchema()` reads markers (and known user-supplied option keys like `format`) to derive the schema. **Inspecting transformer source code via `Function.prototype.toString()` is forbidden** — minifiers rename symbols and rewrite literals, breaking detection silently in production builds.

**Why.**

- The previous heuristic in `DateValidator.toJsonSchema()` did `dataTransformers.some(t => t.toString().includes("YYYY-MM-DD"))` to detect a `.toDateOnly()` transformer. This breaks under any minifier that inlines, hoists, or mangles function bodies — the substring isn't there anymore, the heuristic returns false, and the schema silently emits `format: "date-time"` when the user expected `format: "date"`.
- OpenAI strict mode (and downstream API consumers) accept the wrong schema and produce wrong data shapes. The failure mode is undetectable until you compare emitted vs expected schemas.
- Markers are zero-cost: a plain object property the validator reads at schema generation. Survive any minification.

**Trade-off.** Internal-only convention — marker names start with `__` to signal "not part of the public transformer API". If users write custom transformers that need JSON Schema influence, they must opt in via the same marker mechanism. Document at the point of need.

**Where documented.**

- Plan: `domains/seal/plans/2026-05-12-date-jsonschema-marker-fix.md`.
- Implementation: `validators/date-validator.ts` — `toDateOnly`/`toTimeOnly` set `options.__jsonSchemaFormat`; `toJsonSchema` reads them.

---

## 4. `v.lazy()` ships with simple-resolve JSON Schema in v1; `$ref` + `$defs` deferred

**Date.** 2026-05-12

**Decision.** `LazyValidator.toJsonSchema(target)` calls the thunk and delegates to the inner validator's `toJsonSchema()`. For non-recursive uses this works fine. **For recursive shapes, it infinite-loops** — and that's an acceptable v1 limitation. Users needing JSON Schema for recursive schemas must build the `$defs`/`$ref` structure manually until v2.

**Why.**

- Proper recursive JSON Schema generation requires a context-aware emitter (a registry mapping validators to `$defs` keys, a way to detect "we're already emitting this branch", and `$ref` substitution). That's non-trivial complexity.
- Recursive runtime validation works fine with simple resolve (the stack handles termination naturally). The JSON Schema is a separate concern — most consumers generate it once at build time and ship it as static, where hand-rolling is acceptable.
- v1 ships the validator's runtime behaviour cleanly without taking on the schema-generation refactor. v2 can revisit when there's concrete user demand.

**Trade-off.** Users who need JSON Schema for recursive shapes today have to hand-roll the recursion-safe structure. Documented in the recipe.

**Where documented.**

- Plan: `domains/seal/plans/2026-05-12-lazy-validator.md`.
- Implementation: `validators/lazy-validator.ts` — `toJsonSchema()` delegates without recursion guard.
- Recipe: `domains/seal/docs/recipes/recursive-schemas.md` § "Caveat: JSON Schema is simple-resolve".

---

## 5. Discriminated unions fail eagerly at construction; literals only

**Date.** 2026-05-12

**Decision.** `v.discriminatedUnion(field, branches)` validates the entire construction at schema-build time:

- Every branch must be an `ObjectValidator`
- Every branch must declare the discriminator field
- The discriminator must be typed as `v.literal(...)` (single or multi-literal both work)
- Discriminator values must be unique across branches

Any violation throws synchronously. **Misconfigurations are programmer errors, not user-data errors** — they surface at definition time, caught by tests on first run, not later via "errors come from the wrong branch" symptoms.

**Why.**

- Discriminated unions are a contract between the schema author and the runtime. Misconfiguring them silently (e.g. duplicate literal values, missing field, non-literal discriminator) is a latent bug that's hard to detect at the use site.
- Eager throwing is cheap: schemas are built once at import time, the check is O(branches × literal-values).
- Non-literal discriminators are a category of error rather than a useful feature. If a user wants "any string field as discriminator", they should use `v.union` with a `matchesType` strategy or `.refine()` — discriminated union is specifically the LITERAL-routed variant.

**Trade-off.** No room for "lenient" discriminators that accept regex-matching values. The constraint matches the JSON Schema `oneOf` + `const` pattern, which is what we emit.

**Where documented.**

- Plan: `domains/seal/plans/2026-05-12-discriminated-union.md`.
- Implementation: `validators/discriminated-union-validator.ts` — `buildBranchMap()` enforces all four invariants.
- Recipe: `domains/seal/docs/recipes/polymorphic-data.md` § "Construction-time validation".

---

## 6. `.catch(fallback)` is leaf-only in v1; container catch is no-op

**Date.** 2026-05-12

**Decision.** `.catch(fallback)` is honoured for **leaf validators** (string, number, boolean, date, scalar, …) — the catch hook lives at the bottom of `BaseValidator.validate()`. Container validators (`ObjectValidator`, `ArrayValidator`, `RecordValidator`, `TupleValidator`, `DiscriminatedUnionValidator`) override `validate()` with their own iteration logic and **do not run the catch hook on their own outcome**. Catch on a container instance is a documented no-op in v1.

**Why.**

- Catch's interaction with container iteration is semantically confusing. "If iteration finds errors, substitute the whole container with a fallback" can lead to subtle data corruption — the fallback bypasses per-field validation, so a `.catch({})` on `v.object({...})` would silently accept any field-level errors and emit `{}`.
- Field-level catch (catch on a primitive INSIDE a container) covers the dominant use case: rescuing a single bad LLM output field, a single malformed config value, etc. The container iterates and per-field catches fire individually.
- Whole-container rescue is achievable by the caller wrapping `validate()` in a `try`/`catch` (well, an `if (!result.isValid) return fallback` since validate doesn't throw). No need to bake it into the validator.

**Trade-off.** Users who DO want container-level catch must wrap externally. Documented at the method level and in the recipe. Container catch may ship in a future minor version if real use cases emerge.

**Where documented.**

- Plan: `domains/seal/plans/2026-05-12-catch-fallback.md`.
- Implementation: `validators/base-validator.ts` — catch hook in `validate()`; container overrides don't propagate.
- Skill: `skills/subskills/chaining.md` § "`.catch(fallback)`" → "Scope (v1)".

---

## 7. `Infer<T>` defaults to `Infer.Input<T>`; explicit `Infer.Output<T>` for validated state

**Date.** 2026-05-12

**Decision.** Seal exposes two inference shapes via a namespace + bare type alias:

- `Infer.Input<T>` — what callers may send before validation. `.optional()`, `.default()`, `.catch()` all make a key optional in this shape (any of them means "you don't have to supply this").
- `Infer.Output<T>` — what `validData` contains after validation. `.default()` and `.catch()` guarantee a value, so keys with those brands are required even when chained with `.optional()`.
- `Infer<T>` is a bare type alias for `Infer.Input<T>`.

`InferInput<T>` and `InferOutput<T>` are kept as `@deprecated` flat aliases for one or two minor versions to ease migration.

**Why.**

- In a typical Warlock.js / HTTP-shaped app, *input typing* (request bodies, DTOs, form payloads) is the dominant usage of `Infer<>` — roughly 4-5× more frequent per entity than output-side usage (Model declarations, validated-data downstream).
- Making the dominant case ergonomic — bare `Infer<>` defaulting to Input — matches the mental model "I marked `.optional()`, so the key is optional". Less surprise for newcomers.
- The output case isn't penalized — `Infer.Output<>` is discoverable via autocomplete and only ~7 characters longer. Cascade `Model<>` declarations are a smaller, centralised surface where explicit Output reads well.
- Zod convention (`z.infer<>` = output) is the dominant convention in the wider TS ecosystem. We diverge deliberately: matches Warlock.js stack usage better, accept the migration cost for Zod-trained newcomers. Documented loudly in the skill.

**Trade-off.** Devs from Zod expecting `Infer<>` = output get tripped up once. Mitigated by:
- Loud documentation in SKILL.md, chaining.md, and the optional-fields recipe.
- TypeScript usually surfaces the difference at the use site (e.g. accessing `result.status` when it's optional triggers a strict-null-check error).
- The namespace makes the explicit form discoverable: typing `Infer.` in an editor surfaces both `Input` and `Output` immediately.

**Brand mechanism.** Four type-level brands attached by chain methods:

- `{ isOptional: true }` — `.optional()`
- `{ isNullable: true }` — `.nullable()` / `.nullish()`
- `{ hasDefault: true }` — `.default()`
- `{ hasCatch: true }` — `.catch()`

Both walkers (`Infer.Input` and `Infer.Output`) read these brands; the divergence is in `IsInputOptionalKey` vs `IsOutputOptionalKey`:

```ts
// Input: optional whenever any "I won't supply this" brand is present
type IsInputOptionalKey<V> = V extends
  | { isOptional: true } | { hasDefault: true } | { hasCatch: true }
  ? true : false;

// Output: optional only when literally .optional() AND no value-guaranteeing brand
type IsOutputOptionalKey<V> = V extends { isOptional: true }
  ? IsGuaranteed<V> extends true ? false : true
  : false;
```

`ObjectValidator` is parameterised as `BaseValidator<InferInputObjectShape, InferOutputObjectShape>` — the Standard Schema bridge's `~standard.validate(input)` parameter type matches the actual input shape; the success result type matches the validated output shape. Previously both were the same (output) — using the bridge with input-typed data would have produced false TS errors.

**Where documented.**

- Plan: `domains/seal/plans/2026-05-12-infer-nullable-default-nullish.md` (extended in implementation to add namespace + bare-aliases-Input).
- Implementation: `types/inference-types.ts` — namespace `Infer` with `Input` / `Output`, `InferInputObjectShape` and `InferOutputObjectShape` exported for `ObjectValidator`.
- Skill: `skills/SKILL.md` § "Infer.Input vs Infer.Output" + `chaining.md` § "Infer.Input vs Infer.Output".
- Recipe: `domains/seal/docs/recipes/optional-fields.md` § "Infer<> vs Infer.Input<> vs Infer.Output<>".

---

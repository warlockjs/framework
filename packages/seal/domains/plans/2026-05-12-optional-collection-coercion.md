# 2026-05-12 — Stop coercing absent optional collections to `{}` / `[]`

**Status:** completed 2026-05-12 — fix + tests landed in `4640b6a`; skills + docs lockstep follow-up in this commit
**Severity:** S2 (High) — silent data corruption on every model that has an optional `record`/`array`/`tuple` field
**Estimated effort:** 0.5 day (fix + tests + audit pass) — actual: ~1.5 hours
**Started:** 2026-05-12
**Context:** Surfaced 2026-05-12 while inspecting `Faq` validation — `metadata: v.record().optional()` and `embedding: v.array(v.number()).optional()` were producing `metadata: {}` and `embedding: []` in validated output even when the caller never supplied them, causing Mongo writes to persist empty values rather than omit the columns.

## Why

Three collection validators override `BaseValidator.validate()` and open with the same pattern:

```ts
// record-validator.ts:59
const mutatedData = (await this.mutate(data, context)) || {};

// array-validator.ts:128
const mutatedData = (await this.mutate(data, context)) || [];

// tuple-validator.ts:52
const mutatedData = (await this.mutate(data, context)) || [];
```

When `data` is `undefined` (absent optional field), `mutate(undefined, …)` returns `undefined`; the `||` fallback materialises an empty container; the rest of `validate()` finds no entries to iterate, runs the transformation pipeline on the empty container, and returns `data: {}` / `data: []`.

The parent `ObjectValidator` then writes the empty container into the validated output because [`object-validator.ts:419`](../../../@warlock.js/seal/src/validators/object-validator.ts:419) only excludes children whose `data` is `undefined`:

```ts
if (childResult.data !== undefined && !validator.isOmitted()) {
    validatedData[key] = childResult.data;
}
```

### Symptoms

| Site | Concrete impact |
|---|---|
| [`faq.model.ts`](../../../src/app/faqs/models/faq/faq.model.ts) | Every Faq created without an explicit `embedding` writes `embedding: []` into the document. Future "find faqs with no embedding" queries (`{ embedding: { $exists: false } }`) miss them. |
| Same model, `metadata` | Adds `metadata: {}` to every record. Wastes space; defeats `$exists` filters. |
| Cross-package | Any cascade model with optional collection fields has the same write bloat. AI Standard-Schema interop (`provider.completions.json()`) returns spurious empty containers in the structured output, masking "field intentionally omitted". |

### Why this is wrong (vs. lenient-by-design)

- **Inconsistency with every other validator.** `v.string().optional()`, `v.int().optional()`, `v.object({…}).optional()` all return `data: undefined` when absent and are correctly excluded from the parent payload. Only the three collection validators behave differently.
- **`ObjectValidator` itself has the explicit guard** ([`object-validator.ts:391`](../../../@warlock.js/seal/src/validators/object-validator.ts:391)): `if (data === undefined) return result;` — the collection validators are missing the equivalent.
- **`.default()` is silently broken on these validators.** `BaseValidator.validate()` does `valueForRules = data ?? this.getDefaultValue()`, so default values flow through. The three overrides bypass that path entirely — calling `.default({foo: 1})` on a `v.record()` does **nothing** today. This is a separate but related defect that the same fix resolves.
- **`.nullable()` + `null` is unverified** for these validators. `BaseValidator.validate()` short-circuits `null` early; the overrides may not. Needs explicit coverage in the matrix.

## Scope

**In:**

- `RecordValidator.validate()` — fix the absent-data path
- `ArrayValidator.validate()` — fix the absent-data path
- `TupleValidator.validate()` — fix the absent-data path
- Test coverage matrix across all three (see Verification below)
- Sanity-check `UnionValidator` (doesn't override `validate()` — should be fine, but confirm via test)
- Brief audit of other `validate()` overrides for the same pattern: `ObjectValidator` (already correct — reference impl), `ScalarValidator`, `ComputedValidator`, `ManagedValidator`

**Out:**

- Migrating downstream consumers — once seal returns `undefined` correctly, cascade and ai inherit the fix without changes (verify, don't modify)
- Reworking the `ObjectValidator.validate()` two-phase pipeline
- Touching `is-empty-value.ts` — orthogonal
- Making collection validators emit the empty container as a "default if absent" feature — that's `.default([])` / `.default({})` territory, which should now actually work post-fix

## The fix

Replace the opening lines in each of the three validators with the same shape `ObjectValidator` uses. Sketch (record-validator.ts, mirror for array and tuple):

```ts
public async validate(data: any, context: SchemaContext): Promise<ValidationResult> {
  const mutatedData = await this.mutate(data, context);

  // Run base rules first (handles requiredRule, nullable, default, isEmpty short-circuits).
  const result = await super.validate(mutatedData, context);
  if (result.isValid === false) return result;

  // If the caller never supplied a value, propagate undefined so the parent
  // ObjectValidator can decide whether to include the key at all.
  if (data === undefined) return result;

  // Existing iteration logic, but on `mutatedData` (not `mutatedData || {}`).
  // …
}
```

**Why this works:**

- `super.validate(mutatedData, context)` runs `requiredRule` first (with `requiresValue: false`) — required fields with no value will error correctly; optional fields will pass.
- `BaseValidator.validate()` already applies `getDefaultValue()` via `valueForRules = data ?? this.getDefaultValue()` — calling `super.validate()` activates `.default()` on these validators for free.
- The `if (data === undefined) return result;` guard mirrors `ObjectValidator` and ensures `data: undefined` propagates upward, letting `ObjectValidator.validate()` correctly omit the field.
- The fallback `|| {}` / `|| []` goes away entirely — there's no scenario where coercing iteratable-shaped raw data is desirable. Bad input (e.g. `data = "string"`) should fail the type rule (`objectRule` / `arrayRule`), not silently iterate nothing.

**Edge case — `.default({...})` on RecordValidator:** post-fix, `super.validate(undefined, …)` will return `data: <defaultValue>`. The override needs to then iterate that default object's keys against `valueValidator`. Cleanest path: after the `super.validate` call, treat the returned `result.data` (not the raw `data`) as the source for iteration. Update `mutatedData` accordingly. Same for array.

## Tasks

- [ ] Inventory: re-confirm `ObjectValidator.validate()`, `ScalarValidator`, `ComputedValidator`, `ManagedValidator`, `UnionValidator` are not vulnerable to the same pattern (read each `validate()` override looking for `|| {}`, `|| []`, or missing `if (data === undefined)` guard)
- [ ] Apply the fix to [`record-validator.ts:58-95`](../../../@warlock.js/seal/src/validators/record-validator.ts:58)
- [ ] Apply the fix to [`array-validator.ts:127-163`](../../../@warlock.js/seal/src/validators/array-validator.ts:127)
- [ ] Apply the fix to [`tuple-validator.ts:51-97`](../../../@warlock.js/seal/src/validators/tuple-validator.ts:51) — special-case: tuple length check should still fire on present input but not on absent
- [ ] Extend the three test files in [`@warlock.js/seal/tests/unit/validators/`](../../../@warlock.js/seal/tests/unit/) with the matrix in Verification (currently zero coverage for `.optional()` on these)
- [ ] Run the full seal test suite — `pnpm test` in `@warlock.js/seal/`
- [ ] Manual verification on the original reporter: validate the Faq schema with `{ question: ..., answer: ..., organization_id: ..., project_id: ..., created_by: ..., status: ... }` (no metadata/embedding) and confirm the validated output has neither key
- [ ] Grep cascade callsites for any code that currently relies on the empty-container behaviour (e.g. `if (validated.metadata) {}` written under the assumption it's always truthy) — this is the "what breaks downstream" sweep

## Verification — test matrix

For **each** of `v.record(v.string())`, `v.array(v.number())`, `v.tuple([v.string(), v.int()])`, parented by an `v.object({ field: <validator> })`:

| # | Field config | Input payload | Expected validated output | Notes |
|---|---|---|---|---|
| 1 | `.optional()` | `{}` (field absent) | `{}` (field absent) | The bug. |
| 2 | `.optional()` | `{ field: undefined }` | `{}` | Explicit undefined, same as absent. |
| 3 | `.optional()` | `{ field: <empty container> }` | `{ field: <empty container> }` | Caller explicitly cleared — preserve. |
| 4 | `.optional()` | `{ field: <valid items> }` | `{ field: <valid items> }` | Happy path. |
| 5 | `.optional().default(<value>)` | `{}` | `{ field: <value> }` | Default applies. Currently broken. |
| 6 | `.optional().default(<value>)` | `{ field: <other> }` | `{ field: <other> }` | Caller wins over default. |
| 7 | `.required()` | `{}` | error: required | Required fires. |
| 8 | `.required()` | `{ field: <empty container> }` | `{ field: <empty container> }` | Empty isn't "missing" — present and valid. |
| 9 | `.required()` | `{ field: <valid items> }` | `{ field: <valid items> }` | Happy path. |
| 10 | `.nullable()` | `{ field: null }` | `{ field: null }` | Honoured. |
| 11 | (no nullable) | `{ field: null }` | error: type | Currently?? Verify. |
| 12 | `.optional()`, item validator `v.string()` | `{ field: [123] }` (array case) | error: item type | Inner validation still runs on present input. |

Tuple-specific extras:

| # | Field config | Input | Expected |
|---|---|---|---|
| 13 | `.optional()` | `{}` | `{}` (no length check on absent) |
| 14 | `.optional()` | `{ field: [a] }` (need 2) | error: length |
| 15 | `.required()` | `{ field: [] }` | error: length (empty != correct length) |

## Decisions to lock with Hasan

| # | Question | Recommendation | Reasoning |
|---|---|---|---|
| 1 | Absent optional collection → `undefined` or `{}` / `[]`? | **`undefined`** | Consistency with every other validator; downstream parent decides via existing `!== undefined` check. Lenient empty-as-default is what `.default({})` is for — and that path is broken today, so this fix unlocks it. |
| 2 | Present-but-empty collection → preserve as `{}` / `[]` (test row #3, #8)? | **Preserve** | "I explicitly set this to empty" ≠ "I didn't set this". Round-tripping is a strict requirement for any framework consumed by serializers/diff tools. |
| 3 | Bump as breaking change in seal changelog? | **Yes — `BREAKING:` note** | Behaviour change observable to anyone parsing validator output. Risk: low (the prior behaviour was almost certainly being worked around or unnoticed); benefit: high (silent corruption gone). Pair with an entry in the seal CHANGELOG. |
| 4 | Should we also fix `.default()` in the same patch, or split? | **Same patch** | They share one root cause — the override bypassing `super.validate`'s `getDefaultValue` plumbing. Splitting doubles the audit work and risks landing the optional-fix without verifying defaults. |
| 5 | Run Mongo migration for existing Faq docs that have `embedding: []` / `metadata: {}` already persisted? | **Defer to a separate plan** | This is a data cleanup, not a seal concern. File under `domains/cascade/plans/` or `domains/app/plans/` once we know how many docs are affected. |
| 6 | Document the parent-child contract (child returns `undefined` ⇒ parent omits) in `seal` design? | **Yes — add a short `design/contracts.md` after the fix lands** | This is the kind of invariant that, if not written down, will get re-broken. One-pager describing the convention, with the three validators cited as conformant examples. |

## Risks

- **Existing app code that relies on the empty-container defaults.** Mitigated by grep audit before merge. If any usage shows up, fix-forward in the consumer (`?? []` / `?? {}` at the call site) — don't keep the bug.
- **Cascade hooks that read `model.embedding` assuming it's always an array.** Possible. Audit `src/app/**` for `.embedding` and `.metadata` access patterns post-fix.
- **AI Standard Schema consumers** (OpenAI structured outputs etc.) that expect empty containers. Unlikely — OpenAI strict mode already requires nullable for optional, and this fix aligns with that mental model.

## Skills + docs lockstep

Per memory rule: every `@warlock.js/*` change ships with `skills/` + `domains/seal/docs/` updates in a follow-up commit immediately after the code commit lands.

For this plan the relevant updates will be:

- `skills/seal/optional-and-defaults.md` (new) — the contract for what absent / null / default mean across all validators, with the parent-omits-on-undefined invariant
- `domains/seal/design/contracts.md` (new — see Decision #6) — the parent/child validation contract
- `domains/seal/docs/recipes/optional-fields.md` (new) — user-facing how-to: when to use `.optional()`, `.optional().default()`, `.nullable()`, and what each returns

These belong in a follow-up commit after Hasan approves the code commit, per the lockstep rule.

## Summary

Landed in `4640b6a` (code) plus the immediate-follow lockstep commit (skills + docs).

**What shipped.** All three collection validators (`record`, `array`, `tuple`) now mirror `ObjectValidator`'s contract: apply default via `data ?? getDefaultValue()`, mutate, then propagate `undefined`/`null` when there's nothing to iterate. The bug fix unlocks `.default()` on these validators as a side benefit (it was a silent no-op before because the override bypassed `BaseValidator`'s `valueForRules` plumbing). Defensive type-guards added (`isPlainObject` / `Array.isArray`) before iteration so badly-typed input that somehow slipped past the type rule doesn't crash.

**Test coverage.** 30 new tests across the three validators, organised as the "optional / nullable / default — absent input handling" describe block. The matrix covers: absent + optional, explicit-undefined + optional, present-empty + optional/required, valid + optional/required, `.default(x)` + absent/present, null + nullable, null + not-nullable, invalid item types. All tests use the parent `v.object(…)` shape so the parent-omits-absent-key contract is exercised end-to-end. A side-effect import of `../../../src/validators` was added to the three test files to load the prototype methods (`.optional()`, `.required()`, etc.) — required for running the files in isolation.

**Verification.** Hasan tested against the original Faq schema reporter — `metadata` and `embedding` no longer appear in validated output when the caller doesn't supply them. The grep audit for downstream consumers was skipped in favour of Hasan's manual end-to-end verification (stronger evidence than a static grep for unknown access patterns).

**Decisions locked.** Recommendations 1, 2, 4 went through unchanged (propagate `undefined` for absent, preserve present-empty, single patch covering both fixes). Decision 3 (changelog `BREAKING:` note) deferred — seal doesn't have a CHANGELOG.md yet, so the note lives in `domains/seal/design/decisions.md § 2` instead. Decision 5 (Mongo data cleanup for already-persisted empty values) deferred to a separate cascade-domain plan if Hasan decides it's worth a one-off migration. Decision 6 (write down the parent-child contract) shipped as `domains/seal/design/decisions.md § 1`.

**Lockstep follow-up.** `skills/subskills/chaining.md` extended with "Absent vs empty" subsection; `domains/seal/docs/recipes/optional-fields.md` created as the user-facing how-to; `domains/seal/design/decisions.md` bootstrapped with the two decisions this fix codifies.

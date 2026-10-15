# 2026-05-12 — Introduce `.catch(fallback)` for resilient parsing of untrusted input

**Status:** completed 2026-05-12 — shipped in commit `fdc5ce6`
**Severity:** S3 (Feature gap) — workaround is wrapping `validate()` call sites; ergonomic loss but no functional blocker
**Estimated effort:** 0.5 day — actual: ~1 hour
**Started:** 2026-05-12
**Context:** Surfaced during competitive-positioning audit on 2026-05-12. See [`domains/seal/design/competitive-positioning.md` § Tier 4 polish](../design/competitive-positioning.md). Zod ships this; particularly useful for parsing untrusted-but-best-effort input like LLM outputs, config files, third-party API responses.

## Why

`.default(x)` fires only when input is **absent**. It does NOT rescue invalid input — if the user supplies a bad value, validation fails and `data` is undefined.

`.catch(fallback)` is the complementary operation: if validation produces ANY failure (type wrong, rule failed, missing required), substitute the fallback and return success. The validator becomes "infallible at this field" — useful when the cost of failure is higher than the cost of a wrong value.

**Real use cases in your stack:**

- **LLM output parsing** — model returns malformed JSON, you want to soft-fall-back to a default rather than 500. Especially with `provider.completions.json()` where a single bad field shouldn't blow up the whole agent.
- **Third-party API responses** — vendor changed their schema; you want to keep working with a fallback while you investigate, not crash a critical path.
- **User preferences / config files** — corrupted user setting falls back to defaults; the user keeps using the app while you fix the corruption.
- **Form parsing for analytics** — you want a best-effort parse for telemetry; bad fields become "unknown" instead of dropping the whole event.
- **Schema migrations** — old data in the wrong shape rescues to a known-good fallback rather than blocking reads.

```ts
const config = v.object({
  retries: v.int().min(0).catch(3),                  // bad number → 3
  region: v.string().in(["us", "eu", "ap"]).catch("us"),
  features: v.array(v.string()).catch([]),           // null/wrong shape → empty array
});

// Even with garbage input:
const r = await validate(config, { retries: "not-a-number", region: null, features: "bad" });
// r.isValid === true
// r.data === { retries: 3, region: "us", features: [] }
```

## The complementary picture

| Method | Fires when | Output if no input | Output if invalid input |
|---|---|---|---|
| `.optional()` | absent | key omitted | (rules run — fails) |
| `.default(x)` | absent | `x` (rules then run on `x`) | (rules run — fails) |
| `.catch(x)` | invalid | (no rescue — required check fails) | `x` |
| `.optional().default(x).catch(y)` | absent: `x`, invalid: `y` | `x` | `y` |

Each handles a different failure mode. They compose.

## Scope

**In:**

- `.catch(fallback)` method on `BaseValidator` — accepts a value or callback (lazy fallback)
- Wraps the existing `validate()` flow: if result is `isValid: false`, replace data with fallback, flip isValid to true, drop errors
- Fallback callback receives the errors and the original input, so users can log/alert before swallowing
- Brand the return type with `{ hasCatch: true }` so `Infer<>` can narrow `T | undefined` to `T` (the catch guarantees a value will always be present, regardless of input)
- Works inside `v.object` — a single field's catch doesn't rescue siblings, only its own validation

**Out:**

- Per-rule catch (catch one specific rule's failure but not others) — too niche; users can split into sub-validators
- Async fallback resolution timeouts — if the user's callback is slow, that's their problem
- Catch on `v.object` itself that rescues the whole object — could come later, but partial-object catches are confusing; v1 ships field-level only

## Implementation sketch

```ts
// base-validator.ts — add catch state
protected catchValue: any | ((errors: ValidationResult["errors"], input: any) => any) | undefined;
protected hasCatch = false;

public catch(fallback: any | ((errors: ValidationResult["errors"], input: any) => any)) {
  const instance = this.instance;
  instance.catchValue = fallback;
  instance.hasCatch = true;
  return instance as this & { hasCatch: true };
}

// Hook into validate() — after the existing result is computed:
public async validate(data: any, context: SchemaContext): Promise<ValidationResult> {
  const result = await this.runOriginalValidation(data, context); // existing logic

  if (result.isValid === false && this.hasCatch) {
    const fallback = typeof this.catchValue === "function"
      ? await this.catchValue(result.errors, data)
      : this.catchValue;

    return {
      isValid: true,
      errors: [],
      data: fallback,
    };
  }

  return result;
}
```

Realistically the patch lives at the bottom of `BaseValidator.validate()` ([base-validator.ts:599](../../../@warlock.js/seal/src/validators/base-validator.ts:599)) as the final transform: if `isValid === false` AND `hasCatch`, swap to the fallback.

### Clone behaviour

`.catch()` state must clone like other immutability slots ([base-validator.ts:334](../../../@warlock.js/seal/src/validators/base-validator.ts:334)):

```ts
cloned.catchValue = this.catchValue;
cloned.hasCatch = this.hasCatch;
```

### Brand interaction with `Infer<>`

Same mechanism as `.default()` in the type-system plan — `{ hasCatch: true }` widens `Infer<>` to treat the field as guaranteed-present. Implementations should land together with that plan ([2026-05-12-infer-nullable-default-nullish.md](./2026-05-12-infer-nullable-default-nullish.md)) since they share the type-machinery work.

## Tasks

- [ ] Add `catchValue` + `hasCatch` to `BaseValidator` state ([base-validator.ts](../../../@warlock.js/seal/src/validators/base-validator.ts))
- [ ] Add `.catch(fallback)` method
- [ ] Hook the fallback substitution into the bottom of `validate()`
- [ ] Update `clone()` to copy the catch slots
- [ ] Add `{ hasCatch: true }` brand to method signature
- [ ] Update `Infer<>` to read the brand alongside `hasDefault` (treat both as "guaranteed present")
- [ ] Hand-test matrix below
- [ ] Document interactions with `.default()` and `.optional()` (composition rules)

## Hand-test matrix

```ts
const s = v.object({
  retries: v.int().min(0).catch(3),
  region: v.string().in(["us", "eu", "ap"]).catch("us"),
});

// 1. All valid input
await validate(s, { retries: 5, region: "eu" });
// expect: { retries: 5, region: "eu" }

// 2. Bad type
await validate(s, { retries: "five", region: "eu" });
// expect: { retries: 3, region: "eu" }  ← catch fires for retries

// 3. Rule failure
await validate(s, { retries: -1, region: "eu" });
// expect: { retries: 3, region: "eu" }  ← min(0) failed, catch fires

// 4. Missing required (no .optional)
await validate(s, { region: "eu" });
// expect: { retries: 3, region: "eu" }  ← catch rescues required failure too

// 5. Invalid enum
await validate(s, { retries: 5, region: "mars" });
// expect: { retries: 5, region: "us" }  ← catch for region

// 6. Callback fallback with logging
const schema = v.object({
  user: v.string().catch((errors, input) => {
    console.warn(`bad user value: ${JSON.stringify(input)}`, errors);
    return "anonymous";
  }),
});
await validate(schema, { user: 123 });
// console.warn fires; data.user === "anonymous"

// 7. Combined with default
v.string().optional().default("x").catch("y")
// absent → "x" (default fires, no validation failure)
// invalid → "y" (catch fires)

// 8. Catch inside array iteration
const list = v.array(v.int().catch(0));
await validate(list, [1, "bad", 3]);
// expect: [1, 0, 3]
```

## Decisions to lock with Hasan

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Fallback receives errors + original input, or just errors? | **Both.** `(errors, input) => fallback`. Users often want to log the input alongside the errors. Cheap addition. |
| 2 | Catch rescues `.required()` failure too? | **Yes.** A missing required field IS a validation failure; catch should rescue it just like type-mismatch. Otherwise users have to also add `.optional().default(x)` to handle the absent case, which is verbose. |
| 3 | Does the catch suppress errors entirely (`errors: []`) or hide them but expose via a side channel? | **Suppress entirely on the public result.** Users who want to log the swallowed errors do it inside the callback variant. Mixing isValid=true with errors[] in the result confuses consumers. |
| 4 | Composition with `.default()` — order matters? | **No — composition order is irrelevant.** `.default()` runs at the very start of the pipeline (handles absent input); `.catch()` runs at the very end (handles failed input). Either chain order produces the same behaviour. |
| 5 | Per-rule catch (catch only `.email()` failure but not `.required()`)? | **No, v1.** Niche complexity. Users who need this can split into two sub-fields or write a `.refine()` that returns the fallback explicitly. |
| 6 | `.catch()` brand on the return type for `Infer<>`? | **Yes, bundle with the type-system plan.** Same brand mechanism as `{ hasDefault: true }`. |

## Risks

- **Catch + cross-field rules** — if a sibling depends on a value that got rescued via catch, the sibling sees the fallback, not the original input. Probably what users want (catch is "treat this as the value going forward") but worth documenting.
- **Silent data corruption risk** — overly aggressive use of `.catch()` masks real bugs. Documentation must emphasize: "Use catch when the cost of failure is HIGHER than the cost of a wrong value. Default to not using it; reach for it deliberately." Especially relevant for AI output parsing where invisible fallbacks could mask model drift.
- **Combinatorial config** — `.optional().default(x).nullable().catch(y)` becomes hard to reason about. Add a recipe doc that shows the full truth table.

## Skills + docs lockstep

After landing:

- `skills/subskills/chaining.md` — new section on `.catch(fallback)`, plus the "absent vs invalid vs null" truth table now covering catch
- `domains/seal/docs/recipes/optional-fields.md` — extend with catch column on the quick-reference tables
- `domains/seal/docs/recipes/resilient-parsing.md` (new) — focused recipe: when catch is the right call (LLM outputs, third-party APIs, config files) and when it's a bug-masking footgun
- `domains/seal/design/decisions.md` § 6 — record that catch suppresses errors entirely on the public result; callback variant is the side-channel

## Summary

Landed in commit `fdc5ce6`.

**What shipped.** `BaseValidator` gained two protected state slots (`catchValue`, `hasCatch`) cloned via `clone()`. New `.catch(fallback)` method on `BaseValidator` returning `this & { hasCatch: true }`. Catch hook added at the bottom of `BaseValidator.validate()` — if `isValid === false && hasCatch`, substitutes the fallback value (or runs the callback variant with `errors` and `originalInput`) and returns `{ isValid: true, errors: [], data: fallback }`.

**Scope (v1) — leaf-only.** Catch is honoured for primitive validators (string, number, boolean, date, scalar, …) whose `validate()` flows through `BaseValidator.validate()`. Container validators (`ObjectValidator`, `ArrayValidator`, `RecordValidator`, `TupleValidator`, `DiscriminatedUnionValidator`) override `validate()` and don't go through the hook, so catch on a container is a documented no-op. Per-field catch inside a container DOES work because the field's `validate()` IS the leaf path.

**Type inference.** `{ hasCatch: true }` brand makes the key optional in `Infer.Input` (caller may omit, catch rescues) and required in `Infer.Output` (catch ensures a value). Same effect as `{ hasDefault: true }`.

**Decisions locked.** All six decisions adopted as-recommended:
- Callback receives `(errors, originalInput)`
- Catch rescues required-failure too
- Errors suppressed entirely on the public result (callback variant is the only side-channel)
- Composition with `.default()` is order-independent
- No per-rule catch v1
- Brand integrates with `Infer.Output` via shared `IsGuaranteed`

Decision recorded in `decisions.md § 6` documenting the leaf-only scope.

**Verification.** `tsc --noEmit` clean. Hand-tested with the config-validator example — bad types, rule failures, missing required all rescue via catch as expected; `.default().catch()` composition behaves correctly in both orderings.

**Skills + docs.** `chaining.md` gained a new "`.catch(fallback)`" section + scope note; `recipes/optional-fields.md` extended with `.catch` as the fourth knob and updated truth tables.

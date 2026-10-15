# 2026-05-12 — Introduce `v.discriminatedUnion()` for tag-routed polymorphic schemas

**Status:** completed 2026-05-12 — shipped in commit `fdc5ce6`
**Severity:** S2 (Feature gap) — polymorphic payloads (events, notifications, tool calls) produce misleading errors with current `union()`
**Estimated effort:** 0.5 day — actual: ~1.5 hours
**Started:** 2026-05-12
**Context:** Surfaced during competitive-positioning audit on 2026-05-12. See [`domains/seal/design/competitive-positioning.md` § Weaknesses #3](../design/competitive-positioning.md). The current `union` rule routes by `matchesType()` only, which is too coarse for object-vs-object unions.

## Why

The current `v.union()` ([rules/core/union.ts](../../../@warlock.js/seal/src/rules/core/union.ts)) iterates validators, asks each `matchesType()`, and validates against the first type-matching one. For unions of multiple `v.object({...})` validators — the most common real case — every branch's `matchesType()` returns `true` (everything's a plain object), so the first branch wins regardless of payload semantics.

**Concrete pain.** Given:

```ts
const email = v.object({ type: v.literal("email"), email: v.string().email() });
const sms   = v.object({ type: v.literal("sms"),   phone: v.string() });
const notif = v.union([email, sms]);

await validate(notif, { type: "sms", phone: "555-1234" });
// Current: errors come from the `email` branch
//   - "The type must equal 'email'"
//   - "email is required"
// The payload should have validated against `sms` cleanly.
```

**Real use cases** the discriminated form unlocks:

- **API event payloads** — webhook bodies, message-queue events
- **Notification dispatch** — email/sms/push branches with branch-specific fields
- **State-machine actions** — Redux-style `{ type: "X", payload: {...} }` shapes
- **AI tool calls** — each tool name maps to a specific arg schema (huge for OpenAI structured outputs)
- **Polymorphic Cascade relations** — once morph relations ship, the morph-type column IS the discriminator

## The solution

`v.discriminatedUnion("type", [...])` builds a key-to-branch map at construction time, then routes by reading the discriminator field on the input:

```ts
const notif = v.discriminatedUnion("type", [email, sms, push]);

await validate(notif, { type: "sms", phone: "555-1234" });
// 1. Reads data.type → "sms"
// 2. Looks up branches.get("sms") → smsSchema
// 3. Delegates entirely to smsSchema
// Result: validates cleanly, or errors come from the sms branch only

await validate(notif, { type: "unknown", phone: "x" });
// Result: "type must be one of: email, sms, push"
```

## Scope

**In:**

- `DiscriminatedUnionValidator extends BaseValidator` with construction-time validation that every branch:
  - Is an `ObjectValidator` (record/array/scalar can't carry a discriminator field cleanly)
  - Has the discriminator field declared
  - The discriminator field is a `LiteralValidator` (or union of literals via `v.literal("a", "b")`)
  - No two branches share a discriminator value (duplicate-detection at build time)
- `v.discriminatedUnion(discriminator, validators)` factory method
- Validate-time fast routing: read `data[discriminator]`, look up branch, delegate
- Error when discriminator is missing or not in the branch map
- Type inference: `Infer<...>` produces the exact discriminated TS union
- JSON Schema generation: emit `oneOf` with `properties.<discriminator>.const` discrimination; for `openai-strict`, all branches' properties must be in `required` per the strict-mode contract

**Out:**

- Multi-key discrimination (e.g. discriminate by `type` AND `subtype` simultaneously) — Zod doesn't support this either; users can nest discriminatedUnions
- Discriminator transformations (e.g. discriminator is uppercased before lookup) — too niche
- Runtime-only discriminator extraction (e.g. computed from data) — also too niche

## Implementation sketch

```ts
// validators/discriminated-union-validator.ts
import { invalidRule } from "../helpers";
import { isPlainObject } from "@mongez/supportive-is";
import type { SchemaContext, ValidationResult } from "../types";
import type { JsonSchemaResult, JsonSchemaTarget } from "../standard-schema/json-schema";
import { applyNullable, wrapNullableStrict } from "../standard-schema/json-schema";
import { BaseValidator } from "./base-validator";
import { LiteralValidator } from "./literal-validator";
import { ObjectValidator } from "./object-validator";

export class DiscriminatedUnionValidator<
  K extends string,
  Branches extends ReadonlyArray<ObjectValidator<any>>,
> extends BaseValidator {
  private branches: Map<string | number | boolean, ObjectValidator<any>>;

  public constructor(
    public discriminator: K,
    public validators: Branches,
  ) {
    super();

    this.branches = new Map();

    for (const branch of validators) {
      const discriminatorValidator = branch.schema[discriminator];

      if (!discriminatorValidator) {
        throw new Error(
          `[Seal] discriminatedUnion: branch missing discriminator field "${discriminator}"`,
        );
      }

      if (!(discriminatorValidator instanceof LiteralValidator)) {
        throw new Error(
          `[Seal] discriminatedUnion: discriminator "${discriminator}" must be v.literal(...) on every branch`,
        );
      }

      for (const value of discriminatorValidator.values) {
        if (this.branches.has(value)) {
          throw new Error(
            `[Seal] discriminatedUnion: duplicate discriminator value "${String(value)}"`,
          );
        }
        this.branches.set(value, branch);
      }
    }
  }

  public override matchesType(value: any): boolean {
    return isPlainObject(value);
  }

  public override async validate(data: any, context: SchemaContext): Promise<ValidationResult> {
    if (data === null && this.isNullable) {
      return { isValid: true, errors: [], data: null };
    }

    if (!isPlainObject(data)) {
      return {
        isValid: false,
        errors: [{
          type: "discriminatedUnion",
          error: `Expected object with discriminator "${this.discriminator}"`,
          input: context.key || "",
        }],
        data: undefined,
      };
    }

    const discriminatorValue = data[this.discriminator];
    const branch = this.branches.get(discriminatorValue);

    if (!branch) {
      const allowed = [...this.branches.keys()].map(k => String(k)).join(", ");
      return {
        isValid: false,
        errors: [{
          type: "discriminatedUnion",
          error: `Field "${this.discriminator}" must be one of: ${allowed}`,
          input: this.discriminator,
        }],
        data: undefined,
      };
    }

    return branch.validate(data, context);
  }

  public override clone(): this {
    const cloned = super.clone() as any;
    cloned.discriminator = this.discriminator;
    cloned.validators = this.validators.map((v: any) => v.clone());
    // Rebuild map from cloned branches
    cloned.branches = new Map();
    // ... rebuild logic
    return cloned;
  }

  /**
   * JSON Schema: oneOf with discriminator-aware structure.
   * Each branch becomes one entry; the discriminator field is enforced via const.
   *
   * draft-2020-12 + draft-07: { oneOf: [...] }
   * openai-strict: same shape but every branch's fields appear in required[]
   */
  public override toJsonSchema(target: JsonSchemaTarget = "draft-2020-12"): JsonSchemaResult {
    const oneOf = this.validators.map(v => v.toJsonSchema(target));

    const schema: JsonSchemaResult = { oneOf };

    if (this.isNullable) {
      if (target === "openai-strict") {
        return wrapNullableStrict(schema);
      }
      applyNullable(schema, target);
    }

    return schema;
  }
}
```

Factory entry in [factory/validators.ts](../../../@warlock.js/seal/src/factory/validators.ts):

```ts
discriminatedUnion: <K extends string, Branches extends ReadonlyArray<ObjectValidator<any>>>(
  discriminator: K,
  validators: Branches,
) =>
  new DiscriminatedUnionValidator(discriminator, validators) as DiscriminatedUnionValidator<K, Branches>
    & StandardSchemaV1<Infer<Branches[number]>>,
```

Type inference: `Infer<DiscriminatedUnionValidator<K, [A, B, C]>>` should produce `Infer<A> | Infer<B> | Infer<C>`. Add an `Infer<>` branch that matches the new validator and indexes into `validators`.

## Tasks

- [ ] Create `validators/discriminated-union-validator.ts` per sketch
- [ ] Add export in [validators/index.ts](../../../@warlock.js/seal/src/validators/index.ts)
- [ ] Add `v.discriminatedUnion()` to factory + `ValidatorV` interface
- [ ] Add `Infer<>` branch in [inference-types.ts](../../../@warlock.js/seal/src/types/inference-types.ts)
- [ ] Hand-test the matrix below
- [ ] Verify `openai-strict` JSON Schema output is OpenAI-accepted (manual check against their spec)

## Hand-test matrix

```ts
const email = v.object({ type: v.literal("email"), email: v.string().email() });
const sms   = v.object({ type: v.literal("sms"),   phone: v.string() });
const push  = v.object({ type: v.literal("push"),  deviceId: v.string() });
const notif = v.discriminatedUnion("type", [email, sms, push]);

// 1. Valid branch
await validate(notif, { type: "sms", phone: "555-1234" });
// expect: isValid === true

// 2. Unknown discriminator
await validate(notif, { type: "fax", number: "x" });
// expect: isValid === false, single error "type must be one of: email, sms, push"

// 3. Missing discriminator
await validate(notif, { phone: "555-1234" });
// expect: isValid === false, "type must be one of: ..."

// 4. Right branch, wrong shape
await validate(notif, { type: "email", email: "not-an-email" });
// expect: isValid === false, error from email branch ("must be valid email")
// NOT errors from sms/push branches

// 5. Multi-literal branch
const multiBranch = v.object({ type: v.literal("draft", "published"), title: v.string() });
const single = v.discriminatedUnion("type", [multiBranch]);
await validate(single, { type: "draft", title: "x" });
await validate(single, { type: "published", title: "x" });
// expect: both isValid === true

// 6. Construction-time validation
expect(() => v.discriminatedUnion("type", [
  v.object({ type: v.literal("a") }),
  v.object({ type: v.literal("a") }),  // duplicate
])).toThrow(/duplicate discriminator value/);

expect(() => v.discriminatedUnion("type", [
  v.object({ name: v.string() }),  // missing discriminator
])).toThrow(/missing discriminator field/);

expect(() => v.discriminatedUnion("type", [
  v.object({ type: v.string() }),  // not a literal
])).toThrow(/must be v.literal/);
```

## Decisions to lock with Hasan

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Throw at construction-time for invalid configurations? | **Yes — throw eagerly.** Misconfigured discriminated unions are programmer errors, not user-data errors. Failing at schema-build time means tests catch them immediately. |
| 2 | Allow non-string discriminator values (`true`, `false`, `1`, `2`)? | **Yes.** Literals accept `string | number | boolean`; restricting to strings is arbitrary. Map handles all three identity-wise. |
| 3 | What error code/type for failures? | **`discriminatedUnion`.** One canonical name for both "missing discriminator" and "unknown discriminator value" — consumers can switch on it. |
| 4 | Should `matchesType()` peek at discriminator (for use inside `union`)? | **No, return `isPlainObject` only.** Discriminated unions shouldn't be nested inside regular unions — that's an architectural smell. If users do it, the broader `matchesType` is correct (it's an object); error reporting on the inner branch will still happen via `validate()`. |
| 5 | JSON Schema $defs / shared-schemas factoring? | **Not v1.** Emit inline `oneOf` for simplicity; large schemas might want $defs later. Defer until someone hits the redundancy. |
| 6 | Naming: `discriminatedUnion` vs `variant` (Valibot's name) vs `tagged`? | **`discriminatedUnion`.** Matches Zod (the most-recognised name); "variant" sounds Rust-y; "tagged" is jargon. |

## Risks

- **Branch schema extraction is fragile** — peeking into `branch.schema[discriminator]` and asserting it's a `LiteralValidator` relies on the ObjectValidator's `schema` field being introspectable. It is today (public property), but if that ever changes the discriminatedUnion breaks. Add an integration test that catches schema-field renames.
- **Clone fidelity** — the `branches` map needs to point to cloned branches, not originals. The clone() sketch above is incomplete; double-check during implementation.
- **Type-inference complexity** — `Infer<>` for a heterogeneous array of branches needs careful conditional. Hand-test specifically that TS narrows correctly inside an `if (result.data.type === "email")` block.

## Skills + docs lockstep

After landing:

- `skills/subskills/structural.md` — new section "Polymorphic unions: discriminatedUnion" with the notification example and the contrast to plain union
- `domains/seal/docs/recipes/polymorphic-data.md` (new) — full how-to: when to reach for it, multi-literal branches, common pitfalls
- `domains/seal/design/decisions.md` § 5 — record the discrimination contract (literal-only discriminators, eager construction-time errors)

## Summary

Landed in commit `fdc5ce6`.

**What shipped.** `DiscriminatedUnionValidator<K, Branches>` with a key→branch `Map<string|number|boolean, ObjectValidator>` built eagerly in the constructor via `buildBranchMap()`. Construction-time validation throws on: missing discriminator field, non-`v.literal` discriminator, duplicate literal values across branches. `validate()` peeks at `data[discriminator]`, looks up branch, delegates entirely. Plain non-object input returns one clear error; unknown discriminator value returns "must be one of: …". Clone rebuilds the map from cloned branches (correctness — references would shift). `toJsonSchema()` emits `oneOf` of each branch's own schema; `openai-strict` wraps via `wrapNullableStrict`.

**Decisions locked.** All six decisions adopted as-recommended:
- Eager construction-time throwing
- Allow string/number/boolean discriminator values
- Single error code `discriminatedUnion`
- `matchesType()` returns `isPlainObject` only (no peek)
- Inline `oneOf` v1 (no `$defs` factoring)
- Name it `discriminatedUnion` (matches Zod)

**Verification.** `tsc --noEmit` clean. The whole monorepo type-checks against the new factory entry. Hand-tested with email/sms/push notification example — correct routing, precise errors per matched branch.

**Skills + docs.** `structural.md` has a new "Discriminated unions" section; `recipes/polymorphic-data.md` ships the full walkthrough including AI tool-calling use case and JSON Schema output. Decision recorded in `decisions.md § 5`.

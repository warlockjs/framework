# 2026-05-12 — Introduce `v.lazy()` for recursive and forward-referenced schemas

**Status:** completed 2026-05-12 — shipped in commit `fdc5ce6`
**Severity:** S2 (Feature gap) — recursive shapes are unexpressible today; users hand-roll types or duplicate structure
**Estimated effort:** 0.5 day — actual: ~1 hour
**Started:** 2026-05-12
**Context:** Surfaced during competitive-positioning audit on 2026-05-12. See [`domains/seal/design/competitive-positioning.md` § Weaknesses #2](../design/competitive-positioning.md).

## Why

Self-referencing schemas are impossible today because of JavaScript evaluation order:

```ts
const categorySchema = v.object({
  name: v.string(),
  children: v.array(categorySchema),  // ❌ ReferenceError — categorySchema is undefined
});
```

The object literal is evaluated before the `const` binding completes; `categorySchema` doesn't exist when the inner reference is read.

**Real use cases** that this unblocks:

- **Trees** — categories, file-system nodes, organisational hierarchies, taxonomy
- **Threaded data** — comment threads, reply chains, conversation messages with quoted parents
- **Linked structures** — linked lists, navigation menus, breadcrumb chains
- **Mutually recursive schemas** — `PersonA` references `PersonB` references `PersonA` (rare but real)
- **Forward references** — a schema needs to use one defined later in the file (or in a circular module dep)

Without `lazy()`, users either: (a) hand-roll the TS type and lose runtime validation, (b) duplicate structure for a fixed depth, (c) drop the recursive field and validate it elsewhere. All three are bad.

## The solution

`v.lazy(thunk)` creates a `LazyValidator` that holds a deferred reference to a real validator:

```ts
type Category = {
  name: string;
  children: Category[];
};

const categorySchema: ObjectValidator<...> = v.object({
  name: v.string(),
  children: v.array(v.lazy(() => categorySchema)),
});

type T = Infer<typeof categorySchema>;
// { name: string; children: T[] }   ← recursive type
```

At runtime, `LazyValidator.validate(data, context)` calls the thunk to get the real validator, then delegates entirely to it. The thunk is only invoked at validate-time, so the `categorySchema` reference inside resolves correctly (the binding exists by then).

## Scope

**In:**

- `LazyValidator extends BaseValidator` with a thunk and a memoization slot (call thunk once, cache the result — the validator definition doesn't change between calls)
- `v.lazy(thunk: () => BaseValidator)` factory method
- Type inference: `Infer<LazyValidator<T>>` should expand to `Infer<T>`. TS handles recursive type aliases natively if the user declares one explicitly; the inference helper just needs to not break on lazy
- JSON Schema: emit `$ref` + `$defs` for proper recursion-safe schemas (otherwise `toJsonSchema()` recurses infinitely)
- Clone behaviour: cloning a `LazyValidator` should share the same thunk + memo cache (not re-resolve)

**Out:**

- Automatic recursive-type inference without user annotation — TS limitations make this hard; Zod requires explicit `z.ZodType<Category>` annotation, we'll require the same
- Cycle detection at validate-time — JS already crashes with stack overflow on infinite recursion; not seal's job to babysit

## Implementation sketch

```ts
// validators/lazy-validator.ts
import type { SchemaContext, ValidationResult } from "../types";
import type { JsonSchemaResult, JsonSchemaTarget } from "../standard-schema/json-schema";
import { BaseValidator } from "./base-validator";

export class LazyValidator<T extends BaseValidator = BaseValidator> extends BaseValidator {
  private resolvedValidator: T | undefined;

  public constructor(private thunk: () => T) {
    super();
    // Bypass required by default — lazy is "I'll figure out the real validator later"
    this.requiredRule = null;
    this.isOptional = true;
  }

  /**
   * Resolve the inner validator. Memoizes the result so subsequent calls
   * don't re-execute the thunk (which is supposed to be stable, but cheap insurance).
   */
  private resolve(): T {
    if (this.resolvedValidator === undefined) {
      this.resolvedValidator = this.thunk();
    }
    return this.resolvedValidator;
  }

  public override async validate(data: any, context: SchemaContext): Promise<ValidationResult> {
    return this.resolve().validate(data, context);
  }

  public override matchesType(value: any): boolean {
    return this.resolve().matchesType(value);
  }

  public override clone(): this {
    const cloned = super.clone();
    // Share the thunk; reset memo so cloned can resolve independently if it ever needs to
    (cloned as any).thunk = this.thunk;
    (cloned as any).resolvedValidator = undefined;
    return cloned;
  }

  /**
   * JSON Schema generation with $ref support.
   * The first call emits $defs + $ref; recursive calls reuse the $ref.
   * Requires the caller (the outer toJsonSchema) to maintain a context map.
   *
   * Simpler v1 approach: emit a marker and let downstream tooling handle it,
   * OR limit JSON Schema to one level of resolution and rely on the user to
   * generate a top-level schema with $defs manually.
   *
   * Decision needed (see below).
   */
  public override toJsonSchema(target: JsonSchemaTarget = "draft-2020-12"): JsonSchemaResult {
    // v1: simplest possible — resolve once, generate. Infinite recursion if cyclic.
    // v2: emit { $ref: "#/$defs/<id>" } and require caller to populate $defs.
    return this.resolve().toJsonSchema(target);
  }
}
```

Factory addition in [factory/validators.ts](../../../@warlock.js/seal/src/factory/validators.ts):

```ts
lazy: <T extends BaseValidator>(thunk: () => T) =>
  new LazyValidator(thunk) as LazyValidator<T> & StandardSchemaV1<Infer<T>>,
```

Type inference in [inference-types.ts](../../../@warlock.js/seal/src/types/inference-types.ts) — add a branch:

```ts
T extends LazyValidator<infer V>
  ? Infer<V>
  : // ... rest of conditional chain
```

## Tasks

- [ ] Create `validators/lazy-validator.ts` per sketch above
- [ ] Add `LazyValidator` export to [validators/index.ts](../../../@warlock.js/seal/src/validators/index.ts)
- [ ] Add `v.lazy()` to [factory/validators.ts](../../../@warlock.js/seal/src/factory/validators.ts) factory + matching `ValidatorV` interface entry
- [ ] Update `Infer<T>` branch in [inference-types.ts](../../../@warlock.js/seal/src/types/inference-types.ts)
- [ ] Decide on JSON Schema strategy (see Decisions §)
- [ ] Hand-test with the comment-thread example below; verify TS infers the recursive type with user-supplied annotation

## Hand-test

```ts
// Category tree
type CategoryShape = {
  name: string;
  children: CategoryShape[];
};
const category: BaseValidator = v.object({
  name: v.string(),
  children: v.array(v.lazy(() => category)),
});

const valid = await validate(category, {
  name: "Tech",
  children: [
    { name: "Web", children: [
      { name: "TypeScript", children: [] },
    ]},
    { name: "Mobile", children: [] },
  ],
});
// expect: isValid === true

const invalid = await validate(category, {
  name: "Tech",
  children: [
    { name: 123 /* not a string */, children: [] },
  ],
});
// expect: isValid === false, error path "children.0.name"

// Mutual recursion
type ShapeA = { kind: "A"; b?: ShapeB };
type ShapeB = { kind: "B"; a?: ShapeA };
const a: BaseValidator = v.object({
  kind: v.literal("A"),
  b: v.lazy(() => b).optional(),
});
const b: BaseValidator = v.object({
  kind: v.literal("B"),
  a: v.lazy(() => a).optional(),
});
// Validate a -> b -> a -> ... cycle works without stack overflow as long as data terminates
```

## Decisions to lock with Hasan

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Memoize the thunk result (call once, cache)? | **Yes.** The thunk is supposed to return a stable validator; calling it on every `validate()` is wasteful and could mask bugs where the user accidentally returns a fresh validator each time. |
| 2 | JSON Schema strategy — simple-resolve (v1) or $ref + $defs (v2)? | **Simple-resolve v1.** Most users generating JSON Schema for recursive shapes do so for documentation, not validation downstream. $ref support adds notable complexity (a generation context, a registry) for a feature few users hit. Document the limitation and add $ref later when a real use case appears. |
| 3 | Require user-supplied recursive type annotation on the outer validator? | **Yes, document it.** TS can't infer recursion without an explicit alias. Users will need `const x: ObjectValidator<...> = v.object({...})` style. Same as Zod's `z.ZodType<Category>` pattern. |
| 4 | Make `LazyValidator` itself optional by default (skip required check)? | **Yes.** A lazy wrapper around a required validator should defer the required check to the inner validator. Marking the lazy as `isOptional: true` and `requiredRule: null` does this cleanly. The inner validator's required rules still fire on the actual data. |
| 5 | Should `.matchesType()` resolve and delegate, or always return true? | **Resolve + delegate.** Critical for `union` rule type-routing — if a lazy validator is part of a union, the union needs to know whether the value matches its eventual type. |

## Risks

- **Infinite recursion at validate-time** — if user data has a cycle (`a.children = [a]`), validation infinitely recurses. Not preventable without cycle-detection state; native stack overflow surfaces this clearly. Document as user responsibility.
- **JSON Schema infinite recursion** — same issue at schema-generation time. The simple-resolve v1 will crash on recursive `toJsonSchema()`. Document that recursive schemas don't support `toJsonSchema()` until v2.
- **Type-inference complexity** — the recursive type alias has to be declared by the user. If they get it wrong, TS errors are obscure. Recipe doc should walk through it.

## Skills + docs lockstep

After landing:

- `skills/subskills/structural.md` — add a "Recursive and forward-referenced schemas" subsection with the category-tree example
- `domains/seal/docs/recipes/recursive-schemas.md` (new) — full how-to: when to reach for lazy, how to declare the type alias, what doesn't work yet (`toJsonSchema()`)
- `domains/seal/design/decisions.md` § 4 — record the JSON Schema simple-resolve v1 decision

## Summary

Landed in commit `fdc5ce6`.

**What shipped.** `LazyValidator extends BaseValidator` with a thunk + memoised resolver. Marks itself `isOptional: true` and `requiredRule: null` (defers required-handling to inner). Overrides `validate`, `matchesType`, `clone`, and `toJsonSchema` to delegate. Factory entry `v.lazy(() => schema)` returns `LazyValidator<T> & StandardSchemaV1<Infer<T>>`. `Infer<>` walker reads `LazyValidator<infer L>` first to unwrap before any other branch.

**Decisions locked.** All five decisions adopted as-recommended:
- Memoise the thunk (call once, cache)
- JSON Schema is simple-resolve v1; document `$ref` deferred
- Require user-supplied recursive type alias
- Mark lazy itself as optional (defer required to inner)
- `matchesType()` resolves + delegates

**Verification.** `tsc --noEmit` clean. Hand-tested with the category-tree example — three-level nested data validates correctly; invalid item types fail with the right path.

**Skills + docs.** `structural.md` has a new "Recursive and forward-referenced schemas" section; `recipes/recursive-schemas.md` ships the full walkthrough including mutual recursion + JSON Schema caveat.

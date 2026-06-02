---
title: "Recursive and forward-referenced schemas with `v.lazy`"
sidebar:
  order: 6
  label: "Recursive schemas"
---

Some shapes describe themselves. A category has sub-categories. A comment has replies. A file-system node has children. The natural way to declare these — referencing the schema from inside its own definition — runs into a JavaScript evaluation-order problem:

```ts
const categorySchema = v.object({
  name: v.string(),
  children: v.array(categorySchema),  // ❌ ReferenceError — categorySchema is not defined
});
```

JavaScript evaluates the object literal before the `const` binding completes. `categorySchema` doesn't exist yet when the inner reference is read. `v.lazy(thunk)` is seal's escape hatch.

## The pattern

Wrap the recursive reference in a thunk that resolves at validate-time, not at schema-construction time:

```ts
import { v, validate, type Infer } from "@warlock.js/seal";
import type { ObjectValidator } from "@warlock.js/seal";

type Category = {
  name: string;
  children: Category[];
};

const categorySchema: ObjectValidator<{
  name: ReturnType<typeof v.string>;
  children: ReturnType<typeof v.array>;
}> = v.object({
  name: v.string(),
  children: v.array(v.lazy(() => categorySchema)),
});

type T = Infer<typeof categorySchema>;
// { name: string; children: T[] }   ← recursive type alias
```

Three pieces make this work:

1. **The thunk `() => categorySchema`** — evaluated lazily. By the time `validate()` runs and reaches this code path, the `const` binding has resolved, so the reference works.
2. **The type alias `Category`** — TS can't infer a recursive type from the validator alone. You declare the shape explicitly so `Infer<>` has something to crystallise around.
3. **The explicit annotation `ObjectValidator<...>`** — without this, TS won't accept the type alias's circular reference. Same pattern as Zod's `z.ZodType<Category>` requirement.

## What happens at runtime

`v.lazy(thunk)` returns a `LazyValidator` instance that holds the thunk. On the first call to `validate()`, `matchesType()`, or `toJsonSchema()`, the thunk is invoked once and the result is **memoised** — subsequent calls reuse the cached validator. The thunk is supposed to return a stable validator; memoisation makes that contract explicit.

```ts
const data = {
  name: "Tech",
  children: [
    { name: "Web", children: [
      { name: "TypeScript", children: [] },
    ]},
    { name: "Mobile", children: [] },
  ],
};

const result = await validate(categorySchema, data);
// result.isValid === true
// result.data === { name: "Tech", children: [...] }
```

Validation recurses naturally. The inner `v.lazy(() => categorySchema)` resolves to `categorySchema`, which validates each child, whose `children` array recurses again, and so on. As long as the data terminates, validation terminates.

## Required-handling

`v.lazy()` is itself **optional and required-rule-less** — it defers all required-handling to the inner validator. The inner validator's own `required` / `optional` configuration is what actually runs.

This matters in chains like:

```ts
// "children" is required if the inner ObjectValidator is required-by-default,
// even though the lazy wrapper itself doesn't enforce anything.
children: v.array(v.lazy(() => categorySchema))   // children must be array, items must validate

// To make the children itself optional:
children: v.array(v.lazy(() => categorySchema)).optional()
```

The `.optional()` goes on the OUTER `v.array()`, not on the lazy wrapper.

## Mutually recursive schemas

The same pattern works for two schemas referencing each other:

```ts
type ShapeA = { type: "A"; b?: ShapeB };
type ShapeB = { type: "B"; a?: ShapeA };

const a: ObjectValidator<{
  type: ReturnType<typeof v.literal>;
  b: ReturnType<typeof v.lazy>;
}> = v.object({
  type: v.literal("A"),
  b: v.lazy(() => b).optional(),
});

const b: ObjectValidator<{
  type: ReturnType<typeof v.literal>;
  a: ReturnType<typeof v.lazy>;
}> = v.object({
  type: v.literal("B"),
  a: v.lazy(() => a).optional(),
});
```

Both binding orders work — `a` references `b` (defined later in the file), and `b` references `a` (defined earlier). The thunks defer the references long enough.

## Forward references

Even without recursion, `v.lazy` is useful when a schema needs to reference one defined later in the file (or in a circular module dependency that can't be untangled cleanly):

```ts
// userSchema references roleSchema which is defined below
const userSchema = v.object({
  name: v.string(),
  role: v.lazy(() => roleSchema),
});

const roleSchema = v.object({
  name: v.string(),
  permissions: v.array(v.string()),
});
```

Without the thunk, `roleSchema` is `undefined` when `userSchema`'s literal is evaluated. With it, the resolution waits until validate-time.

## Caveat: JSON Schema is simple-resolve

`v.lazy().toJsonSchema()` calls the thunk and delegates to the inner validator's `toJsonSchema()`. For non-recursive uses this works fine. **For recursive shapes, it infinite-loops** because the resolved schema's children include another lazy, which resolves to the same parent, which... and so on.

If you need JSON Schema for a recursive shape, generate it manually with `$defs` and `$ref` until v2 of seal lands proper `$ref` support:

```ts
const recursiveJsonSchema = {
  $defs: {
    category: {
      type: "object",
      properties: {
        name: { type: "string" },
        children: {
          type: "array",
          items: { $ref: "#/$defs/category" },
        },
      },
      required: ["name", "children"],
    },
  },
  $ref: "#/$defs/category",
};
```

Validation still uses `categorySchema`; only the schema export to OpenAPI/AJV is hand-rolled.

## Performance notes

- The thunk fires **once per validator instance** (memoised). Calling `validate()` 10,000 times on the same schema invokes the thunk once.
- Deep data recurses the call stack — for trees deeper than ~10,000 levels, you'll hit a stack-overflow before seal does anything wrong. Native limitation; document for end users if depth matters.
- Cyclic data (e.g. `a.children = [a]`) loops forever. Seal doesn't detect cycles. If your data might contain cycles, sanitise before validating.

## Related

- [Essentials → Structural shapes](../essentials/03-structural-shapes.md) — `v.lazy` alongside the other structural validators
- [Guides → Generate JSON Schema](../guides/generate-json-schema.md) — the `$defs` + `$ref` workaround for recursive shapes

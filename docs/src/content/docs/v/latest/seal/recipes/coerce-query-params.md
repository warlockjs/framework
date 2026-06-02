---
title: "Coerce query-string and form params"
sidebar:
  order: 4
  label: "Coerce query params"
---

Query strings and form-encoded bodies arrive as strings — always. `?page=2&active=true` gives you `{ page: "2", active: "true" }`, not numbers and booleans. Validating that against `v.int()` fails, because `"2"` is a string, not an integer. The fix is **coercion**: reshape the value before the type rule checks it.

Seal keeps coercion explicit (it never silently coerces behind your back), so you opt in exactly where you need it.

## Numbers — reach for `v.numeric()`

`v.numeric()` accepts numeric strings *and* numbers, and coerces the output to a real number. It's the query-param workhorse.

```ts
import { v, validate, type Infer } from "@warlock.js/seal";

const listQuery = v.object({
  page: v.numeric().min(1).default(1),
  perPage: v.numeric().min(1).max(100).default(20),
});

const result = await validate(listQuery, { page: "3" });
result.data;
// → { page: 3, perPage: 20 }
//   "3" coerced to 3; perPage defaulted because it was absent.
```

Note the difference from `v.int()`, which does **not** coerce:

```ts
await validate(v.object({ page: v.int() }), { page: "3" });
// → ERROR: "The page must be a number" — a string is not an integer.

await validate(v.object({ page: v.numeric() }), { page: "3" });
// → { page: 3 } — numeric coerces the string first.
```

Rule of thumb: **`v.numeric()` for anything that arrives as text** (query, form, headers), **`v.int()` / `v.number()` for JSON bodies** where the client already sent a real number.

## Enums — `.in()` reads strings directly

Enum-style params are already strings, so a plain `v.string().in([...])` works — no coercion needed. Add `.default()` to make the param optional with a sensible fallback:

```ts
const sortQuery = v.object({
  sort: v.string().in(["asc", "desc"]).default("asc"),
});

await validate(sortQuery, { sort: "desc" });   // → { sort: "desc" }
await validate(sortQuery, {});                 // → { sort: "asc" }  (default)
await validate(sortQuery, { sort: "sideways" });
// → ERROR { type: "in", input: "sort" }
```

Want the inferred type to narrow to `"asc" | "desc"` instead of `string`? Use `v.literal("asc", "desc")` instead of `.in([...])` — the literal carries the union into `Infer<>`.

## Booleans — coerce with a mutator

A checkbox or flag arrives as `"true"` / `"false"` (or `"1"` / `"0"`). `v.boolean()` only accepts real booleans, so attach a small mutator to reshape the string *before* the boolean rule runs:

```ts
const flag = v.boolean().addMutator((value) =>
  value === "true" ? true : value === "false" ? false : value,
);

const filterQuery = v.object({
  active: flag.default(true),
});

await validate(filterQuery, { active: "false" });  // → { active: false }
await validate(filterQuery, { active: "true" });   // → { active: true }
```

`.addMutator()` runs in the **pre-validation** stage, so the boolean type rule sees the already-coerced value. (Form-style truthy strings like `"yes"` / `"on"` are better handled with `v.scalar().accepted()` — see [pick the right primitive](../guides/pick-the-right-primitive.md).)

## Dates — `v.date()` already normalizes

`v.date()` ships a built-in mutator that parses date strings and timestamps into a `Date`, so query-string dates need no extra work:

```ts
const rangeQuery = v.object({
  from: v.date().optional(),
  to: v.date().optional(),
});

await validate(rangeQuery, { from: "2024-01-01", to: "2024-12-31" });
// → { from: Date(2024-01-01), to: Date(2024-12-31) }
```

Add `.toISOString()` if you want the output back as a string instead of a `Date`.

## Putting it together — a paginated list endpoint

```ts
const productsQuery = v.object({
  page: v.numeric().min(1).default(1),
  perPage: v.numeric().min(1).max(100).default(24),
  sort: v.string().in(["price", "name", "newest"]).default("newest"),
  inStock: v.boolean()
    .addMutator((value) => value === "true" ? true : value === "false" ? false : value)
    .optional(),
  category: v.string().optional(),
});

type ProductsQuery = Infer.Output<typeof productsQuery>;
// { page: number; perPage: number; sort: "price"|"name"|"newest"; inStock?: boolean; category?: string }

const result = await validate(productsQuery, request.query);

if (result.isValid) {
  // result.data is fully coerced and defaulted — ready to hand to your DB query.
}
```

## Related

- [Validate a request body](./validate-request-body.md) — the JSON-body counterpart
- [Pick the right primitive](../guides/pick-the-right-primitive.md) — `v.numeric` vs `v.int`, `v.scalar().accepted()` for form booleans
- [Essentials → Modifiers](../essentials/02-modifiers.md) — where mutators sit in the pipeline

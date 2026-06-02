# `v.number()` / `v.int()` / `v.float()` / `v.numeric()` — method reference

All four share this surface. The picking guide (which factory to call) is in [`@warlock.js/seal/pick-seal-primitive/SKILL.md`](@warlock.js/seal/pick-seal-primitive/SKILL.md). For `.optional()` / `.in()` / `.oneOf()`, see [`@warlock.js/seal/compose-seal-modifiers/SKILL.md`](@warlock.js/seal/compose-seal-modifiers/SKILL.md).

## Range — global value comparison

| Method | Args | JSON Schema | Example |
|---|---|---|---|
| `.min(n, msg?)` | inclusive lower bound | `minimum: n` | `v.int().min(0)` |
| `.max(n, msg?)` | inclusive upper bound | `maximum: n` | `v.int().max(100)` |
| `.between(a, b, msg?)` | inclusive range | `minimum: a, maximum: b` | `v.number().between(0, 1)` |
| `.greaterThan(n, msg?)` | strict `>` | `exclusiveMinimum: n` | `v.int().greaterThan(0)` |
| `.gt(n, msg?)` | alias for `.greaterThan` | `exclusiveMinimum: n` | — |
| `.lessThan(n, msg?)` | strict `<` | `exclusiveMaximum: n` | `v.int().lessThan(100)` |
| `.lt(n, msg?)` | alias for `.lessThan` | `exclusiveMaximum: n` | — |

`.min` / `.max` / `.between` / `.greaterThan` / `.lessThan` accept a **string** as the value — interpreted as a sibling field name (smart detection):

```ts
v.object({
  minPrice: v.int(),
  maxPrice: v.int().min("minPrice"),  // maxPrice >= minPrice
})
```

Sibling references are **not representable in JSON Schema** — silently omitted from generated output.

## Range — explicit sibling scope

For when smart detection is ambiguous (e.g. a numeric string that happens to match a field name):

| Method | Effect |
|---|---|
| `.minSibling(field, msg?)` | value `>=` sibling field |
| `.maxSibling(field, msg?)` | value `<=` sibling field |
| `.greaterThanSibling(field, msg?)` | value `>` sibling field |
| `.gtSibling(field, msg?)` | alias |
| `.lessThanSibling(field, msg?)` | value `<` sibling field |
| `.ltSibling(field, msg?)` | alias |
| `.betweenSibling(minField, maxField, msg?)` | between two sibling fields |

These **only run inside `v.object`** — sibling resolution silently passes otherwise.

## Sign & parity

| Method | Effect | Example |
|---|---|---|
| `.positive(msg?)` | value `> 0` | `v.int().positive()` |
| `.negative(msg?)` | value `< 0` | `v.int().negative()` |
| `.odd(msg?)` | value is odd | `v.int().odd()` |
| `.even(msg?)` | value is even | `v.int().even()` |

## Divisibility / modulo

| Method | Effect | JSON Schema |
|---|---|---|
| `.modulo(n, msg?)` | value `% n === 0` | `multipleOf: n` |
| `.divisibleBy(n, msg?)` | alias | `multipleOf: n` |
| `.multipleOf(n, msg?)` | alias | `multipleOf: n` |
| `.modulusOf(n, msg?)` | alias | `multipleOf: n` |

## String-form length (rare)

When the numeric value is a fixed-format code (PINs, IDs):

| Method | Effect |
|---|---|
| `.length(n, msg?)` | string-rep length must be exactly `n` |
| `.minLength(n, msg?)` | string-rep length `>= n` |
| `.maxLength(n, msg?)` | string-rep length `<= n` |

For most numeric-shaped IDs you'd use `v.string().length(n).numeric()` instead — let the value be a string.

## Mutators (pre-validation reshape)

| Method | Args | Effect |
|---|---|---|
| `.abs()` | — | `Math.abs(value)` |
| `.ceil()` | — | round up to integer |
| `.floor()` | — | round down to integer |
| `.round(decimals?)` | default 0 | round to N decimals |
| `.toFixed(decimals?)` | default 2 | format as fixed-point |

These run *before* validation rules. If you mutate `1.6` with `.ceil()`, `v.int()` sees `2` and passes. Use mutators when the input arrives in a slightly wrong form and you want to coerce, not reject.

## JSON Schema notes

- `v.number()` → `{ type: "number" }`
- `v.int()` → `{ type: "integer" }`
- `v.float()` → `{ type: "number" }` (no JSON Schema distinction from `number`)
- `v.numeric()` → `{ type: "number" }` (input coercion is a runtime concern)
- `exclusiveMinimum` / `exclusiveMaximum` are encoded as numbers in `draft-2020-12` and `openapi-3.0`, but as boolean flags + `minimum`/`maximum` in `draft-07`.

## Common chains

```ts
// Age
v.int().min(0).max(150)

// Price (cents)
v.int().min(0)

// Probability
v.number().between(0, 1)

// Even page index
v.int().min(0).even()

// Quantity divisible by box size
v.int().min(1).multipleOf(12)

// Coerced from form input
v.numeric().min(0).max(100)

// Cross-field range
v.object({
  startYear: v.int(),
  endYear: v.int().minSibling("startYear"),
})

// Optional with default
v.int().min(0).default(0).optional()
```

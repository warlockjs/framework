# `v.array(itemValidator)` — method reference

The inner validator runs against each element. Failure on any element fails the array. Picking guide (array vs tuple vs record) is in [`@warlock.js/seal/define-structural-shape/SKILL.md`](@warlock.js/seal/define-structural-shape/SKILL.md).

## Length

| Method | Args | JSON Schema | Example |
|---|---|---|---|
| `.min(n, msg?)` | n/a — see note below | — | use `.minLength(n)` |
| `.minLength(n, msg?)` | inclusive lower bound | `minItems: n` | `v.array(v.string()).minLength(1)` |
| `.maxLength(n, msg?)` | inclusive upper bound | `maxItems: n` | `v.array(v.string()).maxLength(10)` |
| `.length(n, msg?)` | exact length | `minItems=maxItems=n` | `v.array(v.string()).length(3)` |
| `.between(a, b, msg?)` | inclusive range | `minItems: a, maxItems: b` | `v.array(v.string()).between(1, 10)` |
| `.lengthBetween(a, b, msg?)` | alias for `.between()` | `minItems: a, maxItems: b` | — |

**Note on `.min`/`.max`:** the array validator does not expose `.min`/`.max` directly — use `.minLength`/`.maxLength` (or `.between`/`.length`). This is intentional: `.min`/`.max` would conflict with primitive value-comparison semantics if they ever bled into here.

## Uniqueness & sort

| Method | Args | Effect |
|---|---|---|
| `.unique(msg?)` | — | every element is distinct |
| `.sorted(direction?, msg?)` | `"asc"` (default) or `"desc"` | array is monotonically sorted |

## Mutators (pre-validation reshape)

| Method | Args | Effect |
|---|---|---|
| `.flip()` | — | reverse the array |
| `.reverse()` | — | alias for `.flip()` |
| `.onlyUnique()` | — | dedupe before validation |
| `.sort(direction?, key?)` | `"asc"` (default) or `"desc"`; optional sort key for object items | sort before validation |

`onlyUnique()` and `unique()` differ: the mutator silently dedupes; the rule fails when duplicates are present. Pick by intent — coerce vs reject.

## Inner validator notes

```ts
v.array(v.string().email())              // every element must be a valid email
v.array(userSchema)                      // every element must satisfy userSchema
v.array(v.array(v.int()))                // matrix-ish — Infer is recursive
```

Element validators run with element-level context. `path` becomes `${parent}.${index}` for error messages. Cross-field rules inside element schemas resolve to that element's fields, not the array.

## JSON Schema mapping

- `v.array(item)` → `{ type: "array", items: <item.toJsonSchema()> }`
- `.minLength(n)` → `minItems: n`
- `.maxLength(n)` → `maxItems: n`
- `.length(n)` → `minItems: n, maxItems: n`
- `.between(a, b)` → `minItems: a, maxItems: b`
- `.unique()` and `.sorted()` are NOT representable — silently omitted

## Common chains

```ts
// Tags
v.array(v.string().min(1)).unique().between(1, 10)

// User list
v.array(userSchema).minLength(1)

// Pre-sorted, deduped
v.array(v.string()).onlyUnique().sort("asc")

// Reverse-emit
v.array(v.string()).flip()

// Matrix
v.array(v.array(v.number())).minLength(1)

// Sorted ids
v.array(v.string().uuid()).sorted("asc").unique()

// Optional list with default
v.array(v.string()).default([]).optional()
```

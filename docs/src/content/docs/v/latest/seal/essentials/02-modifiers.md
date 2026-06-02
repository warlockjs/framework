---
title: "Modifiers"
description: The cross-cutting chain methods — optional, nullable, default, catch, the mutator/transformer pipeline, immutability.
sidebar:
  order: 2
  label: "Modifiers"
---

Modifiers are the chain methods that work on every validator — primitive or structural. They control whether a field can be absent, what its absent value looks like, how to rescue invalid input, and when transformations run.

## The pipeline

When `validate()` runs against a value, the order is:

```
1. default       — fills if input is undefined
2. mutators      — reshape value (string → Date, .trim(), .toUTC())
3. optional/required check — decide whether rules even run
4. requiredRule  — the required-condition rule (.requiredIf, .requiredWith, ...)
5. rules         — every other rule, in declaration order
6. transformers  — reshape value into output (.toISOString, .toLowerCase)
7. catch         — fallback if validation failed (leaf validators only)
```

If a rule fails, transformers don't run. If a leaf validator's chain failed and it has a `.catch(fallback)`, the fallback substitutes and the result reports `isValid: true`.

**Mutator vs transformer mental model:**

- **Mutator** = pre-validation reshape. `v.date()` ships one that parses string inputs. Use when you want rules to see the reshaped value.
- **Transformer** = post-validation reshape. Lands in `result.data`. Use when you only care about the output form.

```ts
// trim BEFORE length check — use a mutator
v.string().addMutator(s => s.trim()).min(3)
// "  Hi  " → mutator trims → "Hi" → fails min(3)

// trim only the OUTPUT — use a transformer (.trim() on string is a transformer)
v.string().min(3).trim()
// "  Hi  " → rules see "  Hi  " (length 6, passes) → trim → result.data = "Hi"
```

## `.optional()` / `.required()` / `.present()`

```ts
v.string()             // required by default inside v.object
v.string().optional()  // type: string | undefined — caller may omit
v.string().present()   // must exist (key present), may be "" or null
v.string().required()  // explicit form — same as default, redundant
```

**Required is the default inside `v.object`.** Skip `.required()` — the inferred type already shows what's required (no `?`) vs optional (`?`). The canonical seal style relies on `.optional()` standing out.

Conditional variants (run inside `v.object` only — sibling resolution needs a parent):

```ts
.requiredIf(field, value)       // required when sibling field === value
.requiredIfSibling(field, value)
.requiredWith(field)            // required when sibling field is present
.requiredWithout(field)         // required when sibling field is absent
.requiredUnless(field, value)
.requiredWhen(callback)         // predicate
.present()                      // key must be present (may be empty)
.presentIf(field, value)
.presentUnless(field, value)
.forbidden()                    // key must be absent
.forbiddenIf(field, value)
```

## `.nullable()` / `.nullish()`

```ts
v.string().nullable()  // type: string | null
v.string().nullish()   // sugar for .optional().nullable()
```

Independent of optional — a field can be required *and* nullable (must be present, but `null` is a valid value). The `{ isNullable: true }` brand widens both `Infer.Input` and `Infer.Output` with `| null`.

## `.default(value | callback)`

```ts
v.string().default("guest")
v.int().default(0)
v.date().default(() => new Date())   // lazy — fresh on each validation
v.array(v.string()).default([])
```

If the input is `undefined` (or the key absent), the default fires and rules run against it. Pass a callback for fresh-per-validation values.

**Defaults still run through rules.** `v.string().min(3).default("a")` fails because `"a"` is shorter than 3. The default is a fallback for *absent* input, not for *invalid* input.

```ts
v.date().defaultNow()   // sugar for .default(() => new Date())
```

The `{ hasDefault: true }` brand makes the key optional in `Infer.Input` (caller doesn't have to send it) and required in `Infer.Output` (`result.data` always has it).

## `.catch(fallback)`

Rescues *failed* validation by substituting a fallback. The complement to `.default()`:

- `.default(x)` fires when input is **absent**.
- `.catch(y)` fires when input is **present but invalid**.

```ts
const config = v.object({
  retries: v.int().min(0).catch(3),
  region: v.string().in(["us", "eu"]).catch("us"),
});

await validate(config, { retries: "five", region: null });
// { isValid: true, data: { retries: 3, region: "us" } }
```

The fallback can be a value or a callback `(errors, originalInput) => fallback` — the callback variant is the only side-channel for the swallowed errors. Log/alert before substituting:

```ts
v.string().uuid().catch((errors, input) => {
  log.warn(`bad uuid: ${JSON.stringify(input)}`, { errors });
  return ANONYMOUS_USER_ID;
});
```

**Leaf-only in v1.** `.catch()` is honoured for **leaf validators** (string, number, boolean, date, …) and for fields inside containers. It's a **no-op on container validators themselves** (`v.object`, `v.array`, `v.record`, `v.tuple`, `v.discriminatedUnion`). To rescue a whole-container failure, wrap the `validate()` call in your own try/catch.

**Best used for** LLM output parsing, third-party API responses, config files — any data where the cost of failure is higher than the cost of a wrong value. Overuse masks real bugs.

## Absent vs empty vs invalid — what comes back

Three failure modes, three different rescue mechanisms:

| Input state | Rescued by | What appears in `result.data` |
| --- | --- | --- |
| Field absent | `.default(x)` | `x` |
| Field absent, no default | `.optional()` | Key **omitted entirely** |
| Field present and invalid | `.catch(y)` | `y` |
| Field is `null` | `.nullable()` | `null` |
| Field present, empty (`""`, `[]`, `{}`) | (none needed) | Preserved as-is |

The "absent vs present-empty" distinction matters when you persist the result. A Mongo document with `tags: []` and one with no `tags` key respond differently to `$exists` queries. Seal preserves the distinction faithfully — absent stays absent, empty stays empty.

```ts
const schema = v.object({
  tags: v.array(v.string()).optional(),
});

(await validate(schema, {})).data
// → {} — `tags` key is NOT present

(await validate(schema, { tags: [] })).data
// → { tags: [] } — present-empty preserved
```

The [optional fields recipe](../recipes/optional-fields.md) has the full truth table.

## Membership rules

Available on every primitive (`v.string`, `v.number`, `v.int`, `v.float`, `v.boolean`, `v.scalar`):

```ts
v.string().in(["admin", "user", "guest"])   // value must match one
v.string().oneOf(["a", "b"])                // alias for .in
v.string().notIn(["banned", "blocked"])     // value must NOT match
v.string().forbids(["banned"])              // alias for .notIn
v.number().allowsOnly([1, 2, 3])            // strict allowlist
v.string().enum(MyTSEnum)                   // accepts a TS enum via Object.values
```

For literal-typed narrowing, use `v.literal(...)` — `oneOf` keeps the broader primitive type.

## `.omit()` / `.exclude()`

```ts
v.object({
  password: v.string(),
  passwordConfirm: v.string().sameAs("password").omit(),
});
```

`.omit()` keeps the field in *validation* but drops it from `result.data` and from `Infer<>`. Use for confirmation/checksum fields that exist only for cross-field rules.

## `.label("Display Name")` — field display name

```ts
v.object({
  email_address: v.string().label("Email Address"),
})
// Error: "The Email Address is required" instead of "The email_address is required"
```

`.label()` sets the field's `:input` placeholder, so its rule messages render the friendly name. (`.attributes({ ... })` is a separate tool — it supplies named substitution values for the translation layer and cross-field rules like `matches`, not a field's own `:input`.) Pair with the translation hook (`configureSeal({ translateRule, translateAttribute })`) for full i18n.

## Mutability — `.mutable` / `.immutable`

Validators are **immutable by default**. Every chain method returns a clone:

```ts
const baseString = v.string();
const required = baseString.required();
// baseString is unchanged
```

This matters because schemas are often shared (`Model.schema = v.object({...})`). If chaining mutated, every reuse would carry forward the previous chain's state.

Toggle in-place with the `.mutable` getter (rare):

```ts
const schema = v.string().mutable.required().min(3);
// Same instance throughout — useful when building dynamically
```

Switch back with `.immutable`. Default immutability is fine 99% of the time.

## Related

- [Inferring types](./04-inferring-types.md) — how `.optional()` / `.default()` / `.catch()` affect `Infer.Input` vs `Infer.Output`.
- [Errors](./05-errors.md) — reading `result.errors`, branching on `error.type`.
- [Recipe → Optional fields](../recipes/optional-fields.md) — the full truth table for absent/present/null inputs.

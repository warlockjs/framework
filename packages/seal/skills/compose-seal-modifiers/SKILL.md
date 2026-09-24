---
name: compose-seal-modifiers
description: 'Apply cross-cutting modifiers — `.optional` / `.nullable` / `.default` / `.catch` / `.omit` / membership rules — plus the mutator-vs-transformer pipeline and `Infer.Input` vs `Infer.Output`. Triggers: `.optional`, `.required`, `.nullable`, `.default`, `.catch`, `.present`, `.requiredIf`, `.requiredWith`, `.in`, `.oneOf`, `.notIn`, `.omit`, `.attribute`, `.mutable`, `.addMutator`, `Infer.Input`, `Infer.Output`; "mark field optional in seal", "default value in schema", "mutator vs transformer", "when does .catch fire"; typical import `import { v, type Infer } from "@warlock.js/seal"`. Skip: primitives — `@warlock.js/seal/pick-seal-primitive/SKILL.md`; containers — `@warlock.js/seal/define-structural-shape/SKILL.md`; errors — `@warlock.js/seal/handle-seal-errors/SKILL.md`; competing `zod` `.optional`/`.default`.'
---

# Cross-cutting modifiers + the pipeline

This skill covers methods that work on **every** validator. Type-specific methods (`.email()`, `.min()` on strings, `.between()` on numbers, `.weekDay()` on dates, etc.) live in the per-type method references — see [`@warlock.js/seal/pick-seal-primitive/SKILL.md`](@warlock.js/seal/pick-seal-primitive/SKILL.md) and [`@warlock.js/seal/define-structural-shape/SKILL.md`](@warlock.js/seal/define-structural-shape/SKILL.md).

## The pipeline

When `validate()` runs against a value, the order is:

```
1. default       — fills if input is undefined
2. mutators      — reshape value (string → Date, .trim(), .toUTC())
3. optional/required check — decide whether to run rules
4. requiredRule  — required-condition rule (.requiredIf, .requiredWith, etc.)
5. rules         — every other rule, in declaration order
6. transformers  — reshape value into data (.toISOString, .toLowerCase)
```

If a rule fails, transformers don't run for that field.

**Mutator vs transformer mental model:**
- **Mutator** = pre-validation reshape. `v.date()` ships one that parses strings. Use when you want rules to see the reshaped value.
- **Transformer** = post-validation reshape. Lands in `data`. Use when you only care about the output form.

```ts
// trim BEFORE length check — use a mutator
v.string().addMutator(s => s.trim()).min(3)
// "  Hi  " → mutator trims → "Hi" → fails min(3)

// trim only the OUTPUT — use a transformer (.trim() on string is a transformer)
v.string().min(3).trim()
// "  Hi  " → rules see "  Hi  " (length 6, passes min(3)) → trim → data = "Hi"
```

## `.required()` / `.optional()` / `.present()`

```ts
v.string()             // already required inside v.object — no need to call .required()
v.string().optional()  // type: string | undefined — { isOptional: true } brand
v.string().present()   // must exist, may be "" / null
v.string().required()  // explicit form — same behavior, redundant
```

**Required is the default inside `v.object`.** Most schemas read cleaner without `.required()` — `Infer<>` already shows what's required (no `?`) vs optional (`?`). Calling `.required()` explicitly is harmless and accepted, but the canonical seal style is to skip it. Keep `.optional()` explicit (it changes behavior); skip `.required()` (it doesn't).

The `{ isOptional: true }` brand survives chaining (`.optional().min(3)` is still optional) and `Infer<>` reads it to make the key optional.

**When `.required()` is still useful:**
- Visual contrast next to `.optional()` siblings when you want the asymmetry to be loud — style call.
- It's not needed for conditional rules — `.requiredIf(field, value)` and friends *replace* the default required-condition slot, so they work standalone.

Conditional variants (run inside `v.object` only):
- `.requiredIf(field, value)` / `.requiredIfSibling(field, value)`
- `.requiredWith(field)` / `.requiredWithSibling(field)`
- `.requiredWithout(field)` / `.requiredWithoutSibling(field)`
- `.requiredUnless(field, value)`
- `.requiredWhen(callback)` — predicate
- `.present()` / `.presentIf(field, value)` / `.presentUnless(field, value)`
- `.forbidden()` / `.forbiddenIf(field, value)` — opposite of present

## `.nullable()` / `.notNullable()` / `.nullish()`

```ts
v.string().nullable()  // type: string | null
v.string().nullish()   // sugar for .optional().nullable()
```

Independent of optional — a field can be required *and* nullable. Defaults to non-nullable. The `{ isNullable: true }` brand widens both `Infer.Input` and `Infer.Output` with `| null`.

## `.default(value | callback)`

```ts
v.string().default("guest")
v.int().default(0)
v.date().default(() => new Date())   // lazy — fresh each validation
v.array(v.string()).default([])
```

If input is `undefined` (or missing), the default is used and rules run against it. Pass a callback for fresh-per-run values. The default fires *before* rules — so `v.string().min(3).default("a")` fails because `"a"` is shorter than 3.

Date sugar: `v.date().defaultNow()` ≡ `.default(() => new Date())`.

The `{ hasDefault: true }` brand makes the key optional in `Infer.Input` (caller doesn't have to send it) and required in `Infer.Output` (data always has it).

## `.catch(fallback)`

Rescues *failed* validation by substituting a fallback. Complement to `.default()`:

- `.default(x)` fires when input is **absent**
- `.catch(y)` fires when input is **present but invalid**

```ts
const config = v.object({
  retries: v.int().min(0).catch(3),
  region: v.string().in(["us", "eu"]).catch("us"),
  features: v.array(v.string()).catch([]),
});

await validate(config, { retries: "five", region: null, features: "x" });
// { isValid: true, data: { retries: 3, region: "us", features: [] } }
```

The fallback can be a value or a callback `(errors, originalInput) => fallback` — the callback variant is the only side-channel for the swallowed errors. Use it to log/alert before substituting.

**Scope (v1).** Catch is honoured for **leaf validators** (string, number, boolean, date, …) and for fields inside containers. It is a **no-op on container validators themselves** (`v.object`, `v.array`, `v.record`, `v.tuple`, `v.discriminatedUnion`) — those use their own iteration logic that bypasses the catch hook. To rescue a whole-container failure, wrap the call site in your own try/catch instead.

**Best used for:** LLM output parsing, third-party API responses, config files, any data where the cost of failure is higher than the cost of a wrong value. Overuse masks real bugs — reach for it deliberately.

The `{ hasCatch: true }` brand has the same effect on `Infer.Input`/`Infer.Output` as `{ hasDefault: true }`.

## `Infer.Input` vs `Infer.Output`

The two inference helpers describe the two halves of the pipeline:

```ts
const schema = v.object({
  bio: v.string().optional(),
  status: v.enum(Status).optional().default(Status.ACTIVE),
  retries: v.int().catch(3),
});

type In  = Infer.Input<typeof schema>;
// {
//   bio?:     string;
//   status?:  Status;      ← default makes caller optional
//   retries?: number;      ← catch makes caller optional
// }

type Out = Infer.Output<typeof schema>;
// {
//   bio?:    string;
//   status:  Status;       ← default guarantees a value
//   retries: number;       ← catch guarantees a value
// }

type Default = Infer<typeof schema>;   // alias for Infer.Input
```

**When to reach for which:**
- `Infer.Input<T>` (or bare `Infer<T>`) — for HTTP request bodies, form payloads, DTOs, anything pre-validation. **The common case in HTTP-shaped code.**
- `Infer.Output<T>` — for Cascade `Model<>` params, validated state, anywhere downstream of `validate()`.

Both widen with `| null` when `.nullable()` is set.

## Absent vs empty vs invalid — what `data` actually contains

Three failure modes, three different rescue mechanisms:

| Input state | Rescued by | What appears in `data` |
| --- | --- | --- |
| Field absent | `.default(x)` | `x` |
| Field absent (no default) | `.optional()` | Key omitted entirely |
| Field present and invalid | `.catch(y)` | `y` |
| Field is `null` | `.nullable()` | `null` |
| Field present, empty (`""`, `[]`, `{}`) | (none needed — empty is a valid value) | Preserved as-is |

Full truth table for an `.optional()` field inside `v.object(…)`:

| Input | What appears in `data` |
| --- | --- |
| Field absent | Key **omitted entirely** (not `undefined`-valued) |
| Field is explicit `undefined` | Key omitted (treated identically to absent) |
| Field is `null` (no `.nullable()`) | Key omitted — for an **optional** field, `null` coalesces to empty and the (cleared) required rule doesn't fire. On a **required** field the same `null` triggers a validation error. |
| Field is `null` with `.nullable()` | Key is `null` |
| Field present and empty (`""`, `[]`, `{}`) | Preserved as-is — empty ≠ absent |
| Field is `.default(x)` and absent | Key is `x` (default fires, then rules run on `x`) |
| Field is `.default(x)` and present | Caller value wins; default is unused |
| Field is `.catch(y)` and validation fails | Key is `y` (catch rescues) |

```ts
const schema = v.object({
  metadata: v.record(v.string()).optional(),
  embedding: v.array(v.number()).optional(),
});

(await validate(schema, {})).data
// → {} — neither key appears
// (NOT { metadata: {}, embedding: [] })

(await validate(schema, { metadata: {}, embedding: [] })).data
// → { metadata: {}, embedding: [] } — present-empty is preserved
```

**Why the distinction matters.** Persistence layers see `key in data` as "user touched this column". Synthesizing `{}` / `[]` for absent input would write empty values to the DB, defeat `$exists` filters, and confuse "I cleared this" vs "I never set this" downstream. Cascade models, Standard-Schema consumers, and JSON serializers all depend on this contract.

Collection validators (`v.record`, `v.array`, `v.tuple`) explicitly honor this — they used to coerce absent input to empty containers (a long-standing bug), but now propagate `undefined` so the parent `v.object` correctly omits the key.

## Membership rules (inherited by every primitive)

Available on `v.string()`, `v.number()`, `v.int()`, `v.float()`, `v.boolean()`, `v.scalar()`:

```ts
v.string().in(["admin", "user", "guest"])   // value must match one
v.string().oneOf(["a", "b"])                // alias for .in
v.string().notIn(["banned", "blocked"])     // value must NOT match
v.string().forbids(["banned"])              // alias for .notIn
v.number().allowsOnly([1, 2, 3])            // stricter — explicit allowlist
v.string().enum(MyTSEnum)                   // accepts a TS enum object via Object.values
```

For literal-typed narrowing (`"admin" | "user" | "guest"` instead of `string`), use `v.literal(...)` instead — `oneOf` keeps the broader primitive type.

## `.omit()` / `.exclude()`

```ts
v.object({
  email: v.string(),
  password: v.string(),
  passwordConfirm: v.string().sameAs("password").omit(),
})
```

`.omit()` keeps the field in *validation* but drops it from `data` and from `Infer<>`. Use for confirmation/checksum fields that exist only for cross-field rules. `.exclude()` is the same idea, used internally for managed/computed plumbing.

## `.label("Display Name")` — field display name

To control the `:input` placeholder in a field's own messages, call `.label()` on the field validator:

```ts
v.object({
  email_address: v.string().label("Email Address"),
})
// Error message: "The Email Address is required" (instead of "The email_address is required")
```

`.label(x)` sets the field's `:input` attribute, so every rule message for that field renders the friendly name.

### `.attributes({ ... })` is a different tool

`.attributes()` does NOT relabel a field's own `:input`. It supplies named substitution values consumed by the translation layer and by rules that reference *other* fields (e.g. `matches`):

```ts
v.string().sameAs("confirmPassword").attributes({
  matches: { confirmPassword: "Confirm Password" },
})
```

For per-field display names use `.label()`; for translated messages wire the `translateRule` / `translateAttribute` hooks via `configureSeal()`.

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

Switch back with `.immutable`. Default is fine 99% of the time. Reach for `.mutable` only when you've thought about who else holds a reference.

## Things NOT to do

- Don't put a transformer where a mutator belongs — `.trim()` is a transformer; if you need trimming *before* `.min()`, use `.addMutator(s => s.trim())`.
- Don't combine `.required()` and `.optional()` on the same chain — last wins, but the intent is unclear; pick one.
- Don't chain `.default("a")` with `.min(3)` and expect `"a"` to pass — the default goes through rules.
- Don't expect `.requiredIf()` to work on a standalone validator outside `v.object` — sibling resolution silently passes.
- Don't mutate a schema you handed to a Model. Default immutability protects you; opting into `.mutable` on shared schemas is asking for confusion.

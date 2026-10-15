---
title: "Compose modifiers"
description: Practical patterns — when to use .optional vs .default vs .catch, mutators before rules, transformers in the output, conditional required.
sidebar:
  order: 2
  label: "Compose modifiers"
---

This guide is the task-shaped companion to [the Modifiers essential](../essentials/02-modifiers.md). It groups the common chain patterns into a "you probably want this when…" list.

## "The caller may omit this field"

```ts
v.string().optional()
```

Standard optional. The key is absent from `result.data` when the caller omits it — *not* undefined-valued. If you read the result with `"key" in data`, you'll get `false` for absent and `true` for present-but-empty.

## "The caller may omit; we substitute a default"

```ts
v.string().optional().default("guest")
v.int().optional().default(0)
v.array(v.string()).optional().default([])

// Fresh per validation
v.date().optional().default(() => new Date())
v.date().optional().defaultNow()  // sugar for the above
```

If the caller sends nothing, `result.data` gets the default. The default still runs through the rules, so `v.string().min(3).optional().default("a")` fails because `"a"` is shorter than 3.

For fresh-per-validation values (timestamps, ids), pass a callback. A bare `.default(new Date())` would freeze a single timestamp at schema-definition time.

## "The caller may send garbage; rescue with a fallback"

```ts
v.int().min(0).catch(3)
v.string().email().catch("noreply@example.com")
v.string().in(["us", "eu"]).catch("us")
```

`.catch(y)` fires when input is *present but invalid*. It swallows the errors and substitutes the fallback. The result reports `isValid: true` with no errors at that field.

For observability when rescuing — log before substituting:

```ts
v.string().uuid().catch((errors, originalInput) => {
  log.warn(`bad uuid received`, { errors, originalInput });
  return ANONYMOUS_USER_ID;
});
```

The callback variant is the only side channel for the swallowed errors. Use it whenever silently rescuing feels wrong.

**Best for** LLM output parsing, third-party API responses, legacy data, config files — anywhere the cost of failure exceeds the cost of a wrong value. Overuse hides real bugs.

## "Rescue both absent and invalid"

```ts
v.string()
  .email()
  .optional()
  .default("noreply@example.com")
  .catch("noreply@example.com");
```

`.default()` fires on absent input. `.catch()` fires on present-but-invalid input. Combine both for belt-and-suspenders semantics.

## "`null` is a meaningful value"

```ts
v.date().nullable()           // type: Date | null
v.string().optional().nullable()
v.string().nullish()          // sugar for .optional().nullable()
```

`.nullable()` is orthogonal to `.optional()`. A field can be required (must be present) *and* nullable (explicit `null` is fine).

`.nullish()` is the common combination — key may be absent OR explicitly `null`.

## "Trim before length check"

`.trim()` on a string validator is a *transformer* — it runs after rules, so it only affects the output. If you need trimming *before* a length check, use a mutator:

```ts
// ❌ rules see "  hi  ", length 6, passes min(3); output is "hi"
v.string().min(3).trim()

// ✅ mutator trims first, then min(3) sees "hi" and fails
v.string().addMutator((s) => s.trim()).min(3)
```

Same pattern for any pre-validation reshape — lowercase before email check, parse a number from a string before range check.

## "Required only when another field has a value"

```ts
v.object({
  shipping_method: v.string().in(["pickup", "delivery"]),
  delivery_address: v.string().requiredIf("shipping_method", "delivery"),
  pickup_location: v.string().requiredIf("shipping_method", "pickup"),
});
```

The conditional variants:

```ts
.requiredIf(field, value)        // required when sibling === value
.requiredWith(field)             // required when sibling is present
.requiredWithout(field)          // required when sibling is absent
.requiredUnless(field, value)
.requiredWhen(callback)          // arbitrary predicate
.presentIf(field, value)         // key must be present (may be empty)
.presentUnless(field, value)
.forbidden()                     // key must be absent
.forbiddenIf(field, value)
```

All resolve siblings against the parent `v.object`. On a standalone scalar validator (no parent), sibling lookup silently passes — the rule has nothing to check against.

For cross-field equality:

```ts
v.object({
  password: v.string().min(8),
  passwordConfirm: v.string().sameAs("password").omit(),
});
```

`.omit()` drops `passwordConfirm` from `result.data` and `Infer<>` — it exists only to enforce the equality check.

## "Constrain to a fixed allowlist"

```ts
v.string().in(["admin", "user", "guest"])
v.string().oneOf(["a", "b"])            // alias for .in
v.number().allowsOnly([1, 2, 3])        // strict allowlist
v.string().notIn(["banned", "blocked"])
v.string().forbids(["banned"])          // alias for .notIn
v.string().enum(MyTSEnum)               // TS enum via Object.values
```

For literal-typed narrowing (so the inferred type is `"a" | "b"` instead of `string`), use `v.literal(...)` instead.

## "Field exists only for cross-field validation"

```ts
v.object({
  password: v.string().min(8),
  passwordConfirm: v.string().sameAs("password").omit(),
  csrfToken: v.string().sameAs("csrfSession").omit(),
});
```

`.omit()` keeps the field in *validation* (so `sameAs` can check it) but drops it from `result.data` and from `Infer<>`. The caller still has to send the field; downstream code never sees it.

## "Customize the error message for one rule"

```ts
v.string()
  .email("Please enter a valid email address")
  .required("Email is required")
  .min(5, "Email must be at least 5 characters");
```

Each chain method takes an optional `errorMessage` as its last argument. For project-wide messages (i18n), wire `translateRule` once via `configureSeal()` instead — see [Handle errors](./handle-errors.md).

## "Per-field display name in error messages"

```ts
v.object({
  email_address: v.string().label("Email Address"),
});
// "The Email Address is required" instead of "The email_address is required"
```

`.label()` sets the field's `:input` placeholder. (`.attributes({ ... })` is a separate tool for the translation layer / cross-field rules like `matches`, not a field's own `:input`.) Combine with `translateRule` / `translateAttribute` for full i18n on field names.

## Things to watch for

- **`.default()` runs through rules.** Make sure the default satisfies the chain — `v.string().min(3).default("a")` fails because `"a"` is shorter than 3.
- **`.catch()` is leaf-only in v1.** Container validators (`v.object`, `v.array`, …) don't run the catch hook on their own outcome — to rescue a whole-container failure, wrap the call in try/catch instead.
- **Sibling rules need a parent `v.object`.** `.requiredIf()`, `.sameAs()`, `.requiredWith()` silently pass on standalone scalars — nothing to resolve against.
- **`.trim()` is a transformer, not a mutator.** Pre-validation reshape needs `.addMutator(s => s.trim())`.
- **Schemas are immutable by default.** Chaining returns a clone. If you opt into `.mutable`, you're responsible for who else holds a reference.

## Related

- [Essentials → Modifiers](../essentials/02-modifiers.md) — the reference behind these patterns.
- [Recipe → Optional fields](../recipes/optional-fields.md) — the absent-vs-present-empty distinction and the full truth table.
- [Handle errors](./handle-errors.md) — `translateRule`, custom messages, the HTTP-422 shape.

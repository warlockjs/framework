---
title: "Your first schema"
description: A 5-minute worked example — define a schema, validate input, infer types, and emit JSON Schema.
sidebar:
  order: 3
  label: "Your first schema"
---

This page walks through the full seal loop in one example. By the end you'll have defined a schema, run validation, derived a TypeScript type from it, and emitted JSON Schema for an external consumer — all from a single declaration.

## The example

A user signup payload — email, optional age, role.

```ts
import { v, validate, type Infer } from "@warlock.js/seal";

const signupSchema = v.object({
  email: v.string().email(),
  age: v.int().min(13).optional(),
  role: v.literal("admin", "user", "guest"),
});
```

Three field declarations:

- `email` — must be a string, must match the email format. Required (the default inside `v.object`).
- `age` — must be an integer, must be at least 13. **Optional** — the caller may omit it.
- `role` — must be one of three literal strings. The literal narrows the type at compile time too.

`v.object({...})` is the structural wrapper. Without it, fields have no parent to resolve cross-field rules against.

## Step 1 — Validate

Call `validate(schema, data)` and branch on `result.isValid`:

```ts
const result = await validate(signupSchema, {
  email: "ada@example.com",
  role: "user",
});

if (result.isValid) {
  console.log(result.data);
  // → { email: "ada@example.com", role: "user" }
  // Note: `age` is omitted, not undefined — see the optional-fields recipe.
} else {
  console.error(result.errors);
}
```

`validate()` never throws on bad input. Bad input lands in `result.errors` as an array of `{ type, error, input }` objects:

```ts
const bad = await validate(signupSchema, {
  email: "not-an-email",
  role: "stranger",
});

bad.isValid;   // false
bad.errors;
// [
//   { type: "email", error: "The email must be a valid email", input: "email" },
// ]
// (firstErrorOnly defaults to true — only one error surfaces per call)
```

Each error carries:

- `type` — the rule name that failed (`"email"`, `"min"`, `"required"`, `"literal"`, …). Branch on this; it's the stable identifier.
- `error` — the human-facing message (translated if you configured a `translateRule` hook).
- `input` — the dot-notation field path (`"email"`, `"address.city"`).

Set `firstErrorOnly: false` via `configureSeal()` to collect every error per field.

## Step 2 — Infer the type

`Infer<typeof schema>` turns the schema into a TypeScript type:

```ts
type Signup = Infer<typeof signupSchema>;
// {
//   email: string;
//   age?: number;
//   role: "admin" | "user" | "guest";
// }
```

Three things to notice:

- `age` is optional because the schema marked it so — the type has `age?: number`.
- `role` is the literal union `"admin" | "user" | "guest"`, not the wider `string`. That's the payoff for using `v.literal(...)` instead of `v.string().oneOf([...])`.
- The schema is the **single source of truth**. Adding a field to the schema adds it to the type — no parallel `type Signup = { ... }` to keep in sync.

If you want the *post-validation* shape (after defaults fire, after `.catch()` rescues), use `Infer.Output<typeof schema>`. The [inferring types essential](../essentials/04-inferring-types.md) page covers the input/output split in detail.

## Step 3 — Emit JSON Schema

The same schema generates JSON Schema for downstream consumers:

```ts
signupSchema.toJsonSchema("draft-2020-12");
// {
//   type: "object",
//   properties: {
//     email: { type: "string", format: "email" },
//     age:   { type: "integer", minimum: 13 },
//     role:  { enum: ["admin", "user", "guest"] },
//   },
//   required: ["email", "role"],
//   additionalProperties: false,
// }
```

Four targets are built in:

- `"draft-2020-12"` — modern JSON Schema (default).
- `"draft-07"` — older tooling, Swagger 2.0.
- `"openapi-3.0"` — OpenAPI 3.0 (uses `nullable: true` instead of type unions).
- `"openai-strict"` — OpenAI's structured-outputs strict mode.

Hand the result straight to OpenAI for typed model output:

```ts
import OpenAI from "openai";

const openai = new OpenAI();

const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Make me a sample signup payload." }],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "signup",
      strict: true,
      schema: signupSchema.toJsonSchema("openai-strict"),
    },
  },
});
```

The [JSON Schema guide](../guides/generate-json-schema.md) covers the differences between targets and the quirks of OpenAI strict mode.

## What you just built

One `signupSchema` constant gave you:

1. Runtime validation that never throws.
2. A typed `Signup` interface synced to the schema.
3. JSON Schema for OpenAI / OpenAPI / AJV consumers.

No casts, no parallel types, no separate JSON Schema file.

## Where to go next

- **Daily reference** — [Essentials → Primitives](../essentials/01-primitives.md) covers the full primitive surface.
- **Modifiers** — [Essentials → Modifiers](../essentials/02-modifiers.md) walks through `.optional()`, `.default()`, `.catch()`, `.nullable()`, the pipeline order.
- **Inference deep-dive** — [Essentials → Inferring types](../essentials/04-inferring-types.md) explains `Infer.Input` vs `Infer.Output`.
- **Common patterns** — [Recipes](../recipes/optional-fields.md) — optional-vs-default-vs-catch, polymorphic data, recursive schemas, ID formats.

---
title: "What is seal?"
description: What seal is, who it's for, and how it compares to zod, valibot, yup, and arktype.
sidebar:
  order: 1
  label: "Introduction"
---

Seal is the validation library shipped with `@warlock.js/seal`. You declare a schema with the `v` factory, and that one declaration covers four jobs at once: runtime validation, TypeScript types, JSON Schema for downstream consumers, and the [Standard Schema](https://standardschema.dev) interop contract.

It's standalone — you can use it in any Node project without pulling in the rest of Warlock — but it's also the engine behind `@warlock.js/cascade` model schemas, `@warlock.js/ai` tool args, and Warlock's HTTP validation pipeline. That dual life shapes how the API reads: ergonomic for backend form validation, with first-class i18n and a deep cross-field rule surface.

## The core idea

You write the shape once.

```ts
import { v, validate, type Infer } from "@warlock.js/seal";

const userSchema = v.object({
  email: v.string().email(),
  age: v.int().min(13).optional(),
});
```

That single `userSchema` constant is now:

- A **runtime validator** — `await validate(userSchema, input)` returns `{ isValid, errors, data }`. It never throws on bad input; bad input lands in `errors`.
- A **TypeScript type** — `type User = Infer<typeof userSchema>` gives you `{ email: string; age?: number }`. No parallel hand-rolled type that can drift.
- A **JSON Schema source** — `userSchema.toJsonSchema("openai-strict")` emits OpenAI structured-output–ready JSON. Same for OpenAPI 3.0, draft-07, draft-2020-12.
- A **Standard Schema** — `userSchema["~standard"]` plugs into any library that accepts `StandardSchemaV1<T>` (LangGraph, TanStack Form, Conform, Valibot adapters).

Three return values, one source of truth, zero hand-maintained duplication.

## Dive in — define, infer, validate

If you only read one snippet, read this one. Define a schema, pull the type out of it, and validate some input — the whole loop in fifteen lines:

```ts
import { v, validate, type Infer } from "@warlock.js/seal";

const userSchema = v.object({
  name: v.string().min(2),
  email: v.string().email(),
  role: v.literal("admin", "member").default("member"),
});

type User = Infer<typeof userSchema>;
// { name: string; email: string; role?: "admin" | "member" }

const result = await validate(userSchema, { name: "Ada", email: "ada@x.io" });

if (result.isValid) {
  result.data; // → { name: "Ada", email: "ada@x.io", role: "member" }
} else {
  result.errors; // [{ type, error, input }]
}
```

That's the entire mental model: `v.*` builds the schema, `Infer<typeof schema>` is the type, `validate(schema, data)` runs it and never throws. Everything else in these docs is detail on top of this loop.

## When to reach for seal

The sweet spot is **backend-shaped validation**:

- HTTP request bodies in a Node API.
- Model schemas in Cascade (or any ORM that accepts a `StandardSchemaV1` slot).
- AI tool arguments — the `openai-strict` JSON Schema target was built specifically for OpenAI structured outputs.
- Form payload validation on the server, with the same schema reused on the client through Standard Schema.
- Config-file parsing, where `.catch(fallback)` rescues bad values without crashing boot.

If you need Laravel-style cross-field rules out of the box (`requiredIf`, `requiredWith`, `sameAs`, `presentIfNotIn`, …) or built-in translation hooks for error messages, seal is comfortable there. If you're building a frontend SPA where bundle size dominates, the lighter options below are worth considering.

## Comparison frame

A quick honest read on where seal sits next to the obvious alternatives.

### vs Zod

Zod is the default for many TypeScript projects, and the comparison is the one most readers reach for first.

- **Where Zod wins.** Type inference precision (Zod carries `.optional()` / `.default()` brands more aggressively into the output type), ecosystem depth, smaller idiomatic bundle, larger community of recipes.
- **Where seal wins.** Cross-field rules at Laravel scale (60+ conditional methods with explicit `sibling` / `global` scoping), built-in i18n via `configureSeal({ translateRule, translateAttribute })`, broader JSON Schema dialect support including a dedicated `openai-strict` target, immutable-by-default chains so shared schemas can't be mutated by accident.

If you live and breathe Zod, seal will read as familiar but Laravel-flavoured. The `.email()` / `.min(3)` / `.optional()` chain shape is identical; the conditional-required surface and translation hooks are where the design diverges.

### vs Valibot

Valibot is the modular pipe-based newcomer. Tiny bundle, tree-shakes at the rule level.

- **Where Valibot wins.** Bundle weight (you import only the rules you use; minimal usage is ~1 KB), pipe composition, Standard Schema since day one.
- **Where seal wins.** Declarative chain API (no `pipe(string(), email(), minLength(3))`), batteries-included date handling (`v.date().past()`, `.weekDay()`, `.minAge(18)`), broader rule library out of the box.

Pick Valibot when bundle size is your top constraint. Pick seal when developer ergonomics and rule breadth matter more than the last kilobyte.

### vs Yup

Yup is the form-validation incumbent — historically paired with Formik.

- **Where Yup wins.** Familiarity in the React form ecosystem.
- **Where seal wins.** Almost everything else — Standard Schema support, JSON Schema export, sharper type inference, deeper cross-field rule surface, ongoing active development.

If you're starting a new project, seal or Zod is the better default; Yup is best reached for when an existing codebase already uses it.

### vs ArkType

ArkType encodes validation as TypeScript type expressions — `type("string > 5")` style — for stunning inference.

- **Where ArkType wins.** Type-system fireworks; the validator and the type are literally the same expression, no `Infer<>` step.
- **Where seal wins.** Plain TypeScript runtime methods (no embedded DSL to learn), built-in i18n, broader JSON Schema dialect support, easier-to-debug stack traces.

ArkType is the right call when type-level precision is paramount and the team is fluent in advanced TypeScript. Seal is the right call when the team values readability and the standard chain idiom.

## What's not in scope

A few things seal deliberately doesn't try to be:

- **A frontend-first validator.** It works fine in the browser, but bundle weight isn't the design priority — Valibot is sharper there.
- **A type-level expression DSL.** Seal is plain runtime methods, not TypeScript type magic — ArkType owns that lane.
- **A general-purpose data parser.** It validates and lightly reshapes (mutators, transformers). For deep data transformation, reach for a dedicated tool.

## Next

The next page — [Installation](./02-installation.mdx) — gets the package into your project. After that, [Your first schema](./03-your-first-schema.md) walks the full define → validate → infer → emit-JSON-Schema loop in one runnable example.

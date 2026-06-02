---
name: overview
description: 'Front-door orientation for `@warlock.js/seal` — framework-agnostic, type-safe validation. The `v` factory builds schemas, `validate(schema, data)` runs them, `Infer<typeof schema>` extracts the type. Primitives, structural shapes (object/array/record/tuple/union/discriminatedUnion/lazy), modifiers, mutators, a plugin system, JSON-Schema export, and a Standard Schema bridge. TRIGGER when: code imports `v`, `validate`, or `Infer` from `@warlock.js/seal`; user asks "what does @warlock.js/seal do", "validation library for Warlock", "compare seal with zod / yup / valibot", "infer a type from a schema", "JSON schema from a validator", "Standard Schema interop"; package.json adds `@warlock.js/seal`. Skip: specific task already known — load the matching task skill directly (`seal-basics`, `pick-seal-primitive`, `define-structural-shape`, `compose-seal-modifiers`, `handle-seal-errors`, `generate-json-schema`, `bridge-standard-schema`, `extend-seal-with-plugins`); framework-specific validators (FileValidator, database rules) live in `@warlock.js/core/v`, not here.'
---

# `@warlock.js/seal` — overview

A type-safe, framework-agnostic validation library. You build a schema with the `v` factory, run it with `validate(schema, data)`, and pull the static type out with `Infer<typeof schema>`. One schema is the runtime check *and* the TypeScript type *and* (optionally) a JSON Schema.

Standalone — no framework required. Ships built-in with `@warlock.js/core`, which adds framework-specific validators (file uploads, database existence/uniqueness rules) on top.

## When to reach for it

- You want a single source of truth for a shape — runtime validation, the TS type, and JSON Schema all from one declaration.
- You'd reach for **zod** / **yup** / **valibot** but want the library the rest of Warlock already speaks (request validation, AI tool inputs, Cascade model schemas).
- You need **JSON Schema output** for OpenAI structured outputs or an OpenAPI spec.

Skip if you only need framework-bound validators (file uploads, DB rules) — those live in `@warlock.js/core/v`, which extends this package.

## The mental model in one paragraph

`v` is a builder: `v.string()`, `v.int()`, `v.object({...})`, `v.array(...)`, and so on, chained with modifiers (`.optional()`, `.nullable()`, `.default(...)`, `.min(...)`). `validate(schema, data)` returns a `ValidationResult` with `isValid`, `data` (the validated value), and `errors[]`. `Infer<typeof schema>` gives you the static type (with `Infer.Input` / `Infer.Output` distinguishing pre- and post-transform shapes). Because every schema implements Standard Schema, it slots into any `StandardSchemaV1<T>` consumer — and `schema.toJsonSchema(target)` emits JSON Schema for external tools.

## Skills index

Eight task skills. Most schemas only need `seal-basics` + `pick-seal-primitive` + `define-structural-shape`.

### Foundations

#### [`seal-basics/`](../seal-basics/SKILL.md)
Start here. The `v` factory, `validate(schema, data)`, and `Infer<typeof schema>`.

### Building schemas

#### [`pick-seal-primitive/`](../pick-seal-primitive/SKILL.md)
Choose the right primitive — `string` / `int` / `literal` / `date` / `enum` / `computed` / `managed` / `instanceof` / `any`. Covers the close calls (`string` vs `scalar`, `int` vs `number`, `literal` vs `enum`).

#### [`define-structural-shape/`](../define-structural-shape/SKILL.md)
Compose `v.object` / `v.array` / `v.record` / `v.tuple` / `v.union` / `v.discriminatedUnion` / `v.lazy` — object schemas, dynamic-keyed records, tagged unions, recursive shapes.

#### [`compose-seal-modifiers/`](../compose-seal-modifiers/SKILL.md)
Cross-cutting modifiers — `.optional` / `.nullable` / `.default` / `.catch` / `.omit` / membership rules — plus the mutator-vs-transformer pipeline and `Infer.Input` vs `Infer.Output`.

### Output + interop

#### [`handle-seal-errors/`](../handle-seal-errors/SKILL.md)
Read a `ValidationResult` — `isValid`, `errors[]`, `data`. Branch on `error.type`, customize messages, hook translation.

#### [`generate-json-schema/`](../generate-json-schema/SKILL.md)
`schema.toJsonSchema(target)` — draft-2020-12 / draft-07 / openapi-3.0 / openai-strict. For OpenAI structured outputs, OpenAPI specs, any JSON-Schema consumer.

#### [`bridge-standard-schema/`](../bridge-standard-schema/SKILL.md)
Standard Schema interop — why a `StandardSchemaV1<T>` slot might reject a schema, the phantom-intersection at the `v` factory return, Cascade `Model<TSchema>` variance. For migrating off `as unknown as` casts.

#### [`extend-seal-with-plugins/`](../extend-seal-with-plugins/SKILL.md)
Author a plugin to add validator methods (`.slug`, `.postalCode`, …) — the `SealPlugin` shape, `registerPlugin` lifecycle, TS prototype augmentation.

## Configuration

`configureSeal({ ... })` sets global behavior (translation hooks, first-error-only mode); `getSealConfig()` reads it; `resetSealConfig()` clears it. Most apps call `configureSeal` once at boot to wire i18n.

## What this package deliberately doesn't do

- **Framework-bound validation.** File-upload and database (exists/unique) rules live in `@warlock.js/core/v`, which builds on this package.
- **Coercion by default.** Seal validates the shape you declare; reshaping is explicit via mutators/transformers, not silent coercion.
- **Async-everywhere.** `validate()` is async to support rules that need it, but the core primitives are synchronous checks.

## See also

- [`@warlock.js/cascade`](../../cascade/skills/overview/SKILL.md) — uses seal schemas as `Model.schema`.
- [`@warlock.js/core`](../../core/skills/overview/SKILL.md) — re-exports `v` (aliased) and adds framework validators in `core/v`.
- [`mongez-agent-kit-authoring-skills`](../../../../domains/shared/skills/) (load via agent-kit sync) — how this becomes `.claude/skills/warlock-js-seal-overview/`.

---
description: 'Type-safe, framework-agnostic validation for Warlock.js: schemas, coercion, modifiers, JSON Schema, Standard Schema. Exports `v`, `validate`, `ObjectValidator`, `StringValidator`, `Infer`, reached as `v.object`, `v.string`, `v.array`, `v.enum`, `v.union`. Use for: "validate this request body", "require an email and a min-length password", "infer the TypeScript type from a schema", "make a field optional or give it a default", "generate JSON Schema", "write a custom rule". Not this package: database rules and file validators live in @warlock.js/core; model schemas and persistence are @warlock.js/cascade.'
---

# @warlock.js/seal

Compose validators from the `v` factory (`v.object({ email: v.string().email() })`), run them with `validate(schema, data)`, and infer static types with `Infer`. Validators chain rules, mutators (transforms) and modifiers; the same schema works as a Standard Schema.

Works standalone and ships with core. `Infer.Input` and `Infer.Output` distinguish pre-transform and post-transform shapes.

## The 80% path

1. Start with `seal-basics.md`.
2. Choose the right primitive: `pick-seal-primitive.md`.
3. Shape nested data: `define-structural-shape.md`.
4. Refine with optional, defaults, nullable and transforms: `compose-seal-modifiers.md`.
5. Handle failures and messages: `handle-seal-errors.md`.
6. Interop: `bridge-standard-schema.md`, `generate-json-schema.md`; extend via `extend-seal-with-plugins.md`.

## Conventions and pitfalls

- Validation is async; always `await validate(...)`.
- The package root is framework-agnostic; database-backed rules (unique, exists) and `FileValidator` come from `@warlock.js/core`, not here.
- Derive types with `Infer` instead of hand-writing parallel interfaces.
- Mutators change the data (trim, cast); order in the chain matters.
- Keep reusable schemas in shared modules so controllers and clients agree.

## When to reach for it

- You want a single source of truth for a shape — runtime validation, the TS type, and JSON Schema all from one declaration.
- You'd reach for **zod** / **yup** / **valibot** but want the library the rest of Warlock already speaks (request validation, AI tool inputs, Cascade model schemas).
- You need **JSON Schema output** for OpenAI structured outputs or an OpenAPI spec.

Skip if you only need framework-bound validators (file uploads, DB rules) — those live in `@warlock.js/core/v`, which extends this package.

## The mental model in one paragraph

`v` is a builder: `v.string()`, `v.int()`, `v.object({...})`, `v.array(...)`, and so on, chained with modifiers (`.optional()`, `.nullable()`, `.default(...)`, `.min(...)`). `validate(schema, data)` returns a `ValidationResult` with `isValid`, `data` (the validated value), and `errors[]`. `Infer<typeof schema>` gives you the static type (with `Infer.Input` / `Infer.Output` distinguishing pre- and post-transform shapes). Because every schema implements Standard Schema, it slots into any `StandardSchemaV1<T>` consumer — and `schema.toJsonSchema(target)` emits JSON Schema for external tools.

## Configuration

`configureSeal({ ... })` sets global behavior (translation hooks, first-error-only mode); `getSealConfig()` reads it; `resetSealConfig()` clears it. Most apps call `configureSeal` once at boot to wire i18n.

## What this package deliberately doesn't do

- **Framework-bound validation.** File-upload and database (exists/unique) rules live in `@warlock.js/core/v`, which builds on this package.
- **Coercion by default.** Seal validates the shape you declare; reshaping is explicit via mutators/transformers, not silent coercion.
- **Async-everywhere.** `validate()` is async to support rules that need it, but the core primitives are synchronous checks.

## See also

- `@warlock.js/cascade` (the `cascade-basics` topic of the `warlock-js-cascade` skill) — uses seal schemas as `Model.schema`.
- `@warlock.js/core` (the `validate-input` topic of the `warlock-js-core` skill) — adds framework validators through `core/v`; import the base `v` from seal.

---
description: "Type-safe, framework-agnostic validation for Warlock.js: schemas, coercion, modifiers, JSON Schema, Standard Schema. Exports `v`, `validate`, `ObjectValidator`, `StringValidator`, `Infer`, reached as `v.object`, `v.string`, `v.array`, `v.enum`, `v.union`. Use for: \"validate this request body\", \"require an email and a min-length password\", \"infer the TypeScript type from a schema\", \"make a field optional or give it a default\", \"generate JSON Schema\", \"write a custom rule\". Not this package: database rules and file validators live in @warlock.js/core; model schemas and persistence are @warlock.js/cascade."
---
# @warlock.js/seal

Compose validators from the `v` factory (`v.object({ email: v.string().email() })`), run them with `validate(schema, data)`, and infer static types with `Infer`. Validators chain rules, mutators (transforms) and modifiers; the same schema works as a Standard Schema.

## The 80% path
1. Orient: `overview.md`, `seal-basics.md`.
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

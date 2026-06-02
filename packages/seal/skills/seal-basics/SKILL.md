---
name: seal-basics
description: 'Start with @warlock.js/seal — the `v` factory, `validate(schema, data)`, and `Infer<typeof schema>`. Triggers: `v`, `validate`, `Infer`, `Infer.Input`, `Infer.Output`, `v.object`, `v.lazy`, `v.discriminatedUnion`, `v.computed`, `v.managed`, `ValidationResult`; "how do I start with seal", "what is the v factory", "validate a schema in warlock", "Infer.Input vs Infer.Output"; typical import `import { v, validate, type Infer } from "@warlock.js/seal"`. Skip: primitive picking — `@warlock.js/seal/pick-seal-primitive/SKILL.md`; modifiers — `@warlock.js/seal/compose-seal-modifiers/SKILL.md`; competing libs `zod`, `valibot`, `yup`, `joi`, `ajv`.'
---

# Validate with seal

Schema-first validation. Single entry point: the `v` factory. Every validator chains, composes, and infers. Schemas double as runtime validators *and* type-level shapes via `Infer<typeof schema>`, and ship `~standard` so any Standard-Schema-aware consumer accepts them directly.

> This skill is the seal **map** — read it first, then load the specific skill for the task.

## Install

```bash
yarn add @warlock.js/seal
```

Most warlock projects already have `@warlock.js/seal` transitively via `@warlock.js/core` (which re-exports the `v` factory and `Infer` types). Import direct from the package you control: `@warlock.js/seal` if you build a leaf package, `@warlock.js/core` if you write app code.

## Minimal example

```ts
import { v, validate, type Infer } from "@warlock.js/seal";

const userSchema = v.object({
  email: v.string().email(),
  age: v.int().min(13).optional(),
  role: v.literal("admin", "user", "guest"),
});

type User = Infer<typeof userSchema>;
// { email: string; age?: number; role: "admin" | "user" | "guest" }

const result = await validate(userSchema, input);
if (result.isValid) {
  result.data;      // typed, post-transformer
} else {
  result.errors;    // [{ type, error, input }, ...]
}
```

## Foundations

The 12 things that are true in every seal use:

1. **Public API is the `v` factory.** Never `new ObjectValidator(...)` from app code — bare classes lose the StandardSchema bridge typing. See [`@warlock.js/seal/bridge-standard-schema/SKILL.md`](@warlock.js/seal/bridge-standard-schema/SKILL.md).
2. **Every factory return is a `StandardSchemaV1<Infer.Output<T>>`.** Pass seal schemas straight into `StandardSchemaV1<T>`-typed slots — no casts.
3. **Two inference helpers — `Infer.Input<T>` and `Infer.Output<T>`.** Bare `Infer<T>` is an alias for `Infer.Input<T>` (the dominant usage: HTTP bodies, DTOs, form payloads). Use `Infer.Output<T>` for validated state (Cascade `Model<>` params, post-`validate()` data). See [the rules below](#inferinput-vs-inferoutput).
4. **Fields are required by default.** Mark optional explicitly: `.optional()`. Skip `.required()` — canonical seal style omits the redundant call; inferred types already show what's required.
5. **`validate(schema, data)` never throws.** Returns `Promise<ValidationResult>` with `{ isValid, data, errors }` — the validated value is `result.data`. See [`@warlock.js/seal/handle-seal-errors/SKILL.md`](@warlock.js/seal/handle-seal-errors/SKILL.md).
6. **Validators are immutable by default.** Every chain method (`.min(3)`, `.email()`, `.optional()`, …) returns a clone. Toggle with the `.mutable` getter.
7. **Two pipelines: mutators (pre-validation), transformers (post-validation).** Order: `default → mutators → required check → required-condition rule → other rules → transformers → data`. `.catch(fallback)` rescues any failure on leaf validators.
8. **Cross-field rules need a `v.object` parent.** Standalone scalar validators have no siblings to resolve against.
9. **JSON Schema generation is built-in.** `schema.toJsonSchema(target)` for `"draft-2020-12"` (default), `"draft-07"`, `"openapi-3.0"`, `"openai-strict"`. See [`@warlock.js/seal/generate-json-schema/SKILL.md`](@warlock.js/seal/generate-json-schema/SKILL.md).
10. **`v.computed` / `v.managed` derive — they don't validate inputs.** They produce values from siblings or context, and are **skipped** when the parent `v.object` emits JSON Schema (runtime-only constructs — calling `.toJsonSchema()` on one directly throws).
11. **`v.lazy(() => schema)` for recursive shapes.** Defers resolution until validate-time so self-referencing types work.
12. **`v.discriminatedUnion(field, branches)` for tagged unions.** Routes by a literal discriminator field instead of `matchesType()` trial — precise errors, exact inference.

## `Infer.Input` vs `Infer.Output`

The two inference shapes describe the two halves of the pipeline:

- **`Infer.Input<T>`** — what the caller sends. `.optional()`, `.default()`, `.catch()` all make a key optional (any of them means "you don't have to supply this").
- **`Infer.Output<T>`** — what `data` contains after validation. `.default()` and `.catch()` guarantee a value, so keys with those brands are required even when chained with `.optional()`.

```ts
const schema = v.object({
  email: v.string().email().optional(),
  status: v.enum(Status).optional().default(Status.ACTIVE),
});

type In  = Infer.Input<typeof schema>;
// { email?: string; status?: Status }     ← caller may omit both

type Out = Infer.Output<typeof schema>;
// { email?: string; status: Status }      ← default fired for status

type Default = Infer<typeof schema>;       // alias for Infer.Input
```

Both flavours widen with `| null` when `.nullable()` is set.

**When to reach for which:**

- `Infer.Input<T>` (or bare `Infer<T>`) — for HTTP request bodies, form payloads, DTOs, anything pre-validation. **The common case in HTTP-shaped code.**
- `Infer.Output<T>` — for Cascade `Model<>` params, validated state, anywhere downstream of `validate()`.

## Pick a skill

| If the task is about… | Load |
| --- | --- |
| Picking the right primitive (`v.string` vs `v.scalar`, `v.literal` vs `v.enum`, `v.date` vs `v.instanceof(Date)`) | [`@warlock.js/seal/pick-seal-primitive/SKILL.md`](@warlock.js/seal/pick-seal-primitive/SKILL.md) |
| Building object / array / record / tuple / union schemas, discriminated unions, recursive schemas | [`@warlock.js/seal/define-structural-shape/SKILL.md`](@warlock.js/seal/define-structural-shape/SKILL.md) |
| Modifiers — `.required` / `.optional` / `.nullable` / `.default` / `.catch` / `.omit`, transformer vs mutator pipelines, membership rules | [`@warlock.js/seal/compose-seal-modifiers/SKILL.md`](@warlock.js/seal/compose-seal-modifiers/SKILL.md) |
| Reading `ValidationResult`, branching on `error.type`, error message customization, translation | [`@warlock.js/seal/handle-seal-errors/SKILL.md`](@warlock.js/seal/handle-seal-errors/SKILL.md) |
| Generating JSON Schema for OpenAI strict / OpenAPI / draft-07 | [`@warlock.js/seal/generate-json-schema/SKILL.md`](@warlock.js/seal/generate-json-schema/SKILL.md) |
| Why a `StandardSchemaV1<T>` slot accepts/rejects a schema, the phantom-intersection design, `Result<unknown>` errors | [`@warlock.js/seal/bridge-standard-schema/SKILL.md`](@warlock.js/seal/bridge-standard-schema/SKILL.md) |
| Authoring custom seal plugins to add validator methods | [`@warlock.js/seal/extend-seal-with-plugins/SKILL.md`](@warlock.js/seal/extend-seal-with-plugins/SKILL.md) |

## Things NOT to do

- Don't `new ObjectValidator(...)` from app code — use `v.object(...)` so the StandardSchema bridge attaches.
- Don't annotate a schema with the bare class type — strips the bridge intersection. Let inference run.
- Don't expect `validate()` to throw on bad input — bad input lands in `result.errors`. The only things that throw are bugs (a rule's callback threw, a transformer threw).
- Don't expect `.requiredIf()` / `.sameAs()` to work on a standalone validator outside `v.object` — sibling resolution silently passes.
- Don't put `.trim()` before `.min(3)` and expect it to trim first — `.trim()` is a transformer (post-validation). For pre-validation trim, attach with `.addMutator(s => s.trim())`.

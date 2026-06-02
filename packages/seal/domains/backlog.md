# Seal backlog

Sequenced from the competitive-positioning audit on 2026-05-12. See [`design/competitive-positioning.md`](./design/competitive-positioning.md) for the broader analysis and [`design/decisions.md`](./design/decisions.md) for locked contracts.

## Active

_(empty — 2026-05-12 audit cohort landed in `fdc5ce6`)_

## Release-polish pass — 2026-06-01 (newest first)

### Fixed (behavior-preserving)

- **`LiteralValidator.clone()` dropped `.values`; `InstanceOfValidator.clone()` dropped `.ctor`.** Neither subclass overrode `clone()`, so the base `BaseValidator.clone()` (which only copies base fields) produced a clone with `values`/`ctor` === `undefined`. Harmless for standalone validation (the rule's options bag still held the values), but **`discriminatedUnion` crashed** (`discriminatorValidator.values is not iterable`) whenever a branch's literal discriminator was cloned — which any chain method does, e.g. `v.discriminatedUnion(...).nullable()` / `.optional()`. Fixed by adding `clone()` overrides to both validators that re-copy the field. Regression test: `tests/unit/validators/clone-preservation.test.ts`.

### Test-suite repair

- **`src/factory/validators.ts` now side-effect-imports the four prototype-augmentation files** (`equality-conditional-methods`, `forbidden-methods`, `present-methods`, `required-methods`). Previously only the `validators/` barrel loaded them, so importing the factory leaf directly (as every test does) produced a half-built `v` missing `.required` / `.requiredIf` / `.sameAs` / `.present` / `.when` / `.forbidden`. Behavior-preserving for the package entry (`src/index.ts` already loaded them via the barrel); this just guarantees the methods exist on any import path.
- **~35 existing test files were out of sync with the immutability refactor.** Root causes: (1) `validator.addRule(rule)` was used as if it mutated in place and/or returned the rule — but `addRule` is now immutable (returns a clone) and returns the *validator*, not the rule. Migrated rule-isolation tests to `addMutableRule` (mutates in place, returns the rule). (2) Several conditional-rule tests (`acceptedIf`/`forbiddenIf`/`presentWith`/…) asserted a conditional method makes a field not-required — it doesn't; the default required rule still fires, so the field needs explicit `.optional()`. (3) A few assertions were simply wrong: `v.string().between(...)` (no such method — it's `lengthBetween`), `roundNumberMutator(10.126)` → 10.13 not 10.12, `objectRule` (loose `isObject`) accepts arrays (use `plainObjectRule` to reject them). Suite now 42 files / 443 tests green.

### Tests added (gap-fill)

- `standard-schema/json-schema.test.ts`, `standard-schema/standard-bridge.test.ts`, `validators/discriminated-union-validator.test.ts`, `validators/lazy-validator.test.ts`, `validators/modifiers.test.ts`, `validators/coercion.test.ts`, `validators/clone-preservation.test.ts`, and a real `validators/immutability.test.ts` (was an empty placeholder). These cover previously-untested surface: JSON-Schema generation across all four targets + openai-strict, the `~standard` validate/jsonSchema bridge, discriminated-union routing + construction-time throws, lazy recursion + memoization, the optional/nullable/nullish/default/catch matrix (absent vs empty vs null vs invalid), and string/numeric/date coercion.

### Doc drift fixed (verified against source)

- **`.attributes()` does not relabel a field's own `:input`.** Five locations (compose-seal-modifiers skill + four docs) claimed `v.object({ x }).attributes({ x: "Label" })` rewrites the message to "The Label …". It does not — that requires `.label("Label")` on the field (which sets `attributesText.input`). `.attributes()` feeds named values to the translation layer / cross-field rules like `matches`. Corrected to `.label()`.
- **An optional field accepts `null`.** Skill + recipe truth tables claimed `null` on an `.optional()` field (no `.nullable()`) is a validation error. It isn't: `data ?? default` coalesces `null` → `undefined` → empty, the (cleared) required rule is skipped, and the key is omitted. Required fields still reject `null` (coalesces to empty → required fires). Corrected.
- Skill `handle-seal-errors` rule-type table corrected: `.pattern()` → type `pattern` (not `regex`); `.sameAs()`/`.differentFrom()` → `equalsField`/`notEqualsField` (not `sameAs`/`notSameAs`); `.optional()` has no error type; string min/max → `minLength`/`maxLength`, number between → `betweenNumbers`.
- Skill `generate-json-schema`: `v.union(...)` emits `oneOf` (not `anyOf`); `v.array().unique()`/`.sorted()` are runtime-only and NOT emitted as `uniqueItems`.
- Skill `pick-seal-primitive` / `string-methods.md`: removed the non-existent `.regex()` (alias claim) — only `.pattern()` exists. Fixed the `v.computed`/`v.managed` callback-signature example (`computed` gets `(data, context)`; `managed` gets `(context)`, with caller extras at `context.context`).

### Remaining ideas folded from the deleted `FEATURE_COMPARISON.md` (low priority, revisit on signal)

- **`.pipe()`** — chain validators sequentially (Zod parity). Seal covers most of this with mutators + transformers; add only if a real sequential-validator case appears.
- **`.keyof()` / `.catchall()` / `.deepPartial()`** on objects — schema-key enum extraction, an unknown-key validator, recursive partial. Niche; no current consumer need.
- **`.finite()` / `.safe()`** number guards (reject `Infinity`, enforce `Number.isSafeInteger`). Cheap to add when a numeric edge case demands it.
- **`.superRefine()`** (emit multiple custom errors from one callback) and **`.brand()`** (nominal typing). Low priority.
- **`set()` / `promise()` validator types** — uncommon shapes; defer until requested.
- Note: the bulk of the old comparison doc was stale — `discriminatedUnion`, `tuple`, `record`, `lazy`, `uuid`/`cuid`/`ulid`/`nanoid`, `nullish`, `notNullable`, `partial`, `requiredFields`, `catch`, and `nullable` are all implemented. The "why seal vs zod/valibot/yup/arktype" framing now lives in `docs/.../getting-started/01-introduction.md`.

## Action items (not plans)

- **Bundle measurement.** Run `bundlejs.com` / `npx esbuild --bundle --minify` on `import { v } from "@warlock.js/seal"` and document the actual byte cost. Currently estimated at 30-40KB min+gzip but unmeasured. Decide if a `seal-mini` carve-out is needed based on data.

## Deferred — revisit when signal appears

- **Error-model overhaul** — `code` discriminator + structured issues + generic `ValidationResult<T>`. Strong DX win but breaking. No real blocking case found in current consumers (Cascade, AI stack). Will become priority if LLM self-correction loops, validation telemetry, or structured-error-rendering-per-locale becomes a concrete need.
- **dayjs as optional dep** — lazy-load inside the date-method bodies that need it. Currently ~7KB forced on every consumer regardless of date usage. Hold until signal of "I don't want dayjs" surfaces from users.
- **Pluggable date adapter via `configureSeal`** — explicitly ruled out: format-token grammars don't agree across libs, configuration burden too high, savings too small. Translation analogy doesn't carry.
- **Container-level `.catch()`** — currently leaf-only by design. Revisit if real use cases for whole-object/array rescue emerge.
- **`$ref` + `$defs` JSON Schema for recursive `v.lazy` shapes** — v1 ships simple-resolve which infinite-loops on recursive shapes. Add when a user needs to generate JSON Schema for a recursive schema and can't hand-roll the structure.
- **Bare `Infer<T>` migration** — currently aliased to `Infer.Input<T>`. Deprecated `InferInput<T>` / `InferOutput<T>` flat aliases kept for one or two minor versions. Remove the flat aliases on next minor bump.

## Recently closed

- **Optional collection validators silently coerce absent input to empty containers** ([plan](./plans/2026-05-12-optional-collection-coercion.md)) — closed 2026-05-12 in commit `4640b6a`. `v.record()` / `v.array()` / `v.tuple()` now propagate `undefined` for absent input so the parent `v.object` correctly omits the key. Side benefit: `.default()` on these three validators now actually works (was a silent no-op).
- **Date JSON-schema marker fix** ([plan](./plans/2026-05-12-date-jsonschema-marker-fix.md)) — closed 2026-05-12 in `fdc5ce6`. Replaced `t.toString().includes(…)` source-inspection with explicit `__jsonSchemaFormat` markers; minifier-safe.
- **`Infer<>` carries nullable / default / nullish brands + `Infer.Input`/`Infer.Output` namespace** ([plan](./plans/2026-05-12-infer-nullable-default-nullish.md)) — closed 2026-05-12 in `fdc5ce6`. Brand-aware walker; bare `Infer<T>` aliases `Infer.Input<T>`; deprecated flat aliases retained for migration.
- **`v.lazy()` for recursive and forward-referenced schemas** ([plan](./plans/2026-05-12-lazy-validator.md)) — closed 2026-05-12 in `fdc5ce6`. `LazyValidator` with memoised thunk; JSON Schema is simple-resolve in v1.
- **`v.discriminatedUnion()` for tag-routed polymorphic schemas** ([plan](./plans/2026-05-12-discriminated-union.md)) — closed 2026-05-12 in `fdc5ce6`. Construction-time validation throws on misconfiguration; emits `oneOf` JSON Schema.
- **Modern ID-format validators (UUID/CUID/ULID/nanoid)** ([plan](./plans/2026-05-12-modern-id-validators.md)) — closed 2026-05-12 in `fdc5ce6`. UUID maps to `format: "uuid"`; others fall back to `pattern`.
- **`.catch(fallback)` for resilient parsing** ([plan](./plans/2026-05-12-catch-fallback.md)) — closed 2026-05-12 in `fdc5ce6`. Leaf-only in v1; container-level rescue deferred.

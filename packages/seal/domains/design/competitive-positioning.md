# `@warlock.js/seal` — competitive positioning

**Date.** 2026-05-12
**Status.** Snapshot analysis — refresh as the field moves
**Scope.** Honest assessment of where seal stands against Zod, Valibot, Yup, Joi, ArkType, TypeBox after a full source-read pass (12.5k LOC across 119 files, tests excluded).

This doc is internal. It exists so future planning sessions don't re-derive the same conclusions and so Hasan can argue for or against design changes from a shared baseline. Refresh when the competitive landscape shifts (Zod 5, Valibot 1.0 stabilising, etc.) or when seal lands big features.

---

## TL;DR

Seal is a **declarative, Laravel-flavoured validator with first-class i18n and a full Standard Schema + JSON Schema bridge**. Its strengths and weaknesses both come from the same place: it optimised for *backend form-validation ergonomics* (Hasan's actual day-job pain) rather than for *frontend bundle size* or *type-system fireworks*. It will read as familiar to Laravel devs and alien to Zod-heads.

If positioned as "Zod competitor for general TS use" it loses on bundle size, ecosystem depth, type-inference precision, and maintainer count. If positioned as "**the validator for Warlock.js apps**" — which is the actual scope — it's already differentiated and several capabilities are genuinely ahead of every competitor surveyed.

Three things lock the moat:

1. **i18n built in, not bolted on.** Translation hooks live in the rule context — every error message, every attribute, every placeholder routes through user-supplied translators with a documented priority chain ([validation-helpers.ts:23](../../../@warlock.js/seal/src/helpers/validation-helpers.ts:23)).
2. **Cross-field declarative rules at Laravel scale** — 60+ conditional methods (`requiredIfEmpty`, `presentIfNotIn`, `forbiddenIfNotInSibling`, …) with explicit `global` vs `sibling` scoping. No competitor comes close.
3. **Standard Schema + JSON Schema natively** — including a custom `openai-strict` target nobody else has shipped. Worth gold for AI tool-calling and OpenAPI generation.

Three things hold it back:

1. **Type inference loses information.** `.nullable()` doesn't widen output type to `T | null`; `.default()` doesn't narrow `T | undefined` to `T`. Compared to Zod 4 / Valibot, this gives up real DX.
2. **Bundle weight + dayjs runtime dep.** Tree-shaking is at-package-best, not at-rule-best like Valibot. Bringing seal into a frontend project costs more than it should.
3. **Error model is thin.** Errors are `{type, error, input}[]` strings — no discriminated codes, no nested issue trees, no structured `expected/received` info. Limits programmatic error handling.

The strategic positioning that fits these facts: **"Seal is the form-and-API validator for the Warlock.js stack — Laravel-grade conditional rules and i18n out of the box, with full AI-tooling interop via Standard Schema."** Compete on that, not on "Zod alternative".

---

## The competitive landscape

| Library | Differentiator | Where it crushes seal | Where seal crushes it |
|---|---|---|---|
| **Zod** | Default for everything; large ecosystem; precise inference | Inference (carries optional/nullable/default into output type); bundle (tree-shakes well at v4); error tree with codes; community/recipes | Cross-field rules, i18n, JSON Schema dialect breadth |
| **Valibot** | Modular pipe-based design; tiny minimal bundle; Standard Schema since day one | Bundle (you import only what you use, ~1KB minimal); composability; performance | Conditional cross-field surface, declarative API style, batteries-included date handling |
| **Yup** | Form-validation incumbent (esp. Formik); decent `.when()` | Older + simpler API; React form ecosystem familiarity | Almost everything else — Yup's growth has stalled, no Standard Schema, weaker types |
| **Joi** | Battle-tested server-side validator (Hapi roots); rich error messages; conditional via `.when()` | Maturity; rule depth in some areas (URI, schema descriptions) | TS inference (Joi has none), cross-field method count, plugin model, bundle (Joi is heavy) |
| **ArkType** | Parses TS-like type strings ("string|number"); fastest validation; type-first identity | Inference precision (literally executes TS-like syntax at runtime); raw perf | Conventional chained API, conditional cross-field rules, i18n, ergonomics for non-TS-fluent devs |
| **TypeBox** | JSON Schema-first; fastest at runtime via AJV codegen | Performance for high-throughput APIs; native JSON Schema | Conditional rules, cross-field, transformations, mutators, i18n |

**No serious competitor ships Laravel-style cross-field conditionals.** Zod's `.refine()` is the workaround. Valibot's `.check()` is similar. Joi's `.when()` is the closest peer but has a fraction of the surface.

**No serious competitor ships built-in i18n.** All require BYO translation wrapping.

**Three competitors ship Standard Schema** (Zod, Valibot, ArkType) — seal is in the right club but late to it.

---

## Strengths — concrete

### 1. Cross-field declarative rules are world-class

Counted from [methods/required-methods.ts](../../../@warlock.js/seal/src/validators/methods/required-methods.ts), [present-methods.ts](../../../@warlock.js/seal/src/validators/methods/present-methods.ts), [forbidden-methods.ts](../../../@warlock.js/seal/src/validators/methods/forbidden-methods.ts), [equality-conditional-methods.ts](../../../@warlock.js/seal/src/validators/methods/equality-conditional-methods.ts):

- `required*`: 25 variants (`requiredWith`, `requiredWithout`, `requiredIf`, `requiredUnless`, `requiredIfEmpty`, `requiredIfNotEmpty`, `requiredIfAllEmpty`, `requiredIfAnyEmpty`, `requiredIfIn`, `requiredIfNotIn`, `requiredWithAll`, `requiredWithAny`, `requiredWithoutAll`, `requiredWithoutAny`, `requiredWhen` — each with `*Sibling` counterpart)
- `present*`: ~22 variants (mirror set)
- `forbidden*`: ~13 variants
- `same/different/equal/when/whenSibling`: 7 variants

Total: **60+ cross-field methods on every validator**, all going through one shared rule pipeline ([base-validator.ts](../../../@warlock.js/seal/src/validators/base-validator.ts)) with explicit `global` (whole-payload) vs `sibling` (immediate-parent) scoping.

**Why this matters.** The dirtiest part of any real form is rules like "tax ID required if account type is business AND country is US, but only when compliance flag isn't waived". Zod handles this with `.superRefine()` callbacks that the user has to write inline; Yup with one `.when()` per condition; Joi with a `.when().then().otherwise()` ladder. Seal handles it with a chain that reads like the spec: `v.string().requiredIf("accountType", "business").requiredIf("country", "US").requiredUnless("compliance.waived", true)`.

The *sibling* scope deserves special mention — it solves a problem most validators ignore. When validating `users: v.array(v.object({...}))`, you usually want a child rule to check a *sibling* field (in the same row) rather than a global field. Zod and Valibot make you reach for the parent context explicitly; seal makes it a method suffix.

### 2. Standard Schema + JSON Schema bridge is the right architecture

[base-validator.ts:702](../../../@warlock.js/seal/src/validators/base-validator.ts:702) ships `~standard` natively without taking `@standard-schema/spec` as a runtime dep — types are vendored in [standard-schema/types.ts](../../../@warlock.js/seal/src/standard-schema/types.ts). Every validator instance is directly assignable to `StandardSchemaV1<T>` slots used by:

- OpenAI structured outputs
- LangChain/LangGraph tool calling
- TanStack Form
- Conform (Remix forms)
- Valibot adapters, Hono validators, etc.

`toJsonSchema(target)` accepts four targets: `draft-2020-12` (default), `draft-07`, `openapi-3.0`, `openai-strict` ([standard-schema/json-schema.ts](../../../@warlock.js/seal/src/standard-schema/json-schema.ts), [standard-schema/types.ts:118](../../../@warlock.js/seal/src/standard-schema/types.ts:118)). The `openai-strict` target — which puts every field in `required` and expresses optionals as nullable types so OpenAI's strict mode accepts the schema — is custom and doesn't exist in any competitor I've checked. For an AI-platform stack like Warlock.js, this is unique leverage.

Counterpoint: implementation is hand-rolled per validator (each `toJsonSchema()` walks its own rule list looking up rule names — see [string-validator.ts:474](../../../@warlock.js/seal/src/validators/string-validator.ts:474), [number-validator.ts:298](../../../@warlock.js/seal/src/validators/number-validator.ts:298)). That works but is fragile when rules are renamed, and you don't notice until a downstream consumer breaks. A central registry would help.

### 3. i18n is first-class, not bolted on

[validation-helpers.ts:23](../../../@warlock.js/seal/src/helpers/validation-helpers.ts:23) — `resolveTranslation()` documents a 3-tier priority chain:

1. Direct text override (developer wrote `attributes({ field: "Email Address" })`)
2. Explicit translation key (`transAttributes({ field: "user.email_address" })` → translator)
3. Auto-translate the raw value (translator(rawValue) as fallback)

Both *rule names* (so "min" → "must be at least :min characters") and *attribute names* (so "email_address" → "Email Address") flow through user-supplied callbacks. Placeholder substitution (`:input`, `:min`, `:field`) is built in with a regex fallback if no translator is configured ([validation-helpers.ts:90](../../../@warlock.js/seal/src/helpers/validation-helpers.ts:90)).

**Why this matters.** Every other library treats i18n as "pass an `errorMap` and write your own switch". Zod's `errorMap` is per-call; Valibot has no built-in i18n. For the kind of multi-language app Warlock.js is built for, this is a meaningful productivity win.

### 4. The mutator/transformer split is a real improvement

The pipeline is documented and consistent ([base-validator.ts:599](../../../@warlock.js/seal/src/validators/base-validator.ts:599)):

```
default → mutators → required check → requiredRule → other rules → transformers → validData
```

- **Mutators** (pre-validation): `.trim()`, `.lowercase()`, `.toStartOfDay()`, `.asNumber()` — reshape the value so rules see the cleaned form
- **Transformers** (post-validation): `.toISOString()`, `.toJSON()`, `.outputAs(fn)` — reshape `validData` for downstream

Zod blurs this with `.transform()` (post) and `.preprocess()` (pre, but separated from the schema). Valibot does pipes that don't distinguish. Yup mixes `.transform()` for both. Seal's split is mentally cleaner — you can predict where in the pipeline a method runs from its name.

**Caveat.** This only matters if you *use* mutators. The Faq schema you sent me has none. Most users probably never reach for them. But for backend processing (data normalization before persistence), it's the right abstraction.

### 5. Date validator surface is unmatched

[date-validator.ts](../../../@warlock.js/seal/src/validators/date-validator.ts) ships **75+ methods**: comparison (`min`/`max`/`before`/`after` with smart value-vs-field detection), sibling variants, ranges (`between`, `betweenYears`, `betweenMonths`, `betweenDays`), age (`age`, `minAge`, `maxAge`, `betweenAge`, `birthday`), day-of-week (`weekDay`, `weekdays`, `weekend`, `businessDay`), period (`month`, `year`, `quarter`, `leapYear`), time (`fromHour`, `beforeHour`, `betweenHours`, `betweenTimes`), relative (`withinDays`, `withinPastDays`, `withinFutureDays`), mutators (`toStartOfDay`, `addDays`, `addMonths`, `toUTC`, `toEndOfMonth`), transformers (`toISOString`, `toFormat`, `toDateOnly`, `toTimeOnly`, `toTimestamp`).

For comparison, Zod's date validator has ~5 methods. Joi has ~6. Yup has ~5. Even ArkType is sparse here.

**Caveat.** Cost is dayjs as a runtime dep — `~7KB min+gzip`. Not free for frontend bundles.

### 6. Computed + Managed fields are unique

`v.computed(callback, [resultValidator])` ([computed-validator.ts](../../../@warlock.js/seal/src/validators/computed-validator.ts)) and `v.managed(callback)` ([managed-validator.ts](../../../@warlock.js/seal/src/validators/managed-validator.ts)) — these derive values from validated siblings (computed) or from injected context (managed) rather than validating user input. Object validation runs in two phases: validate user-input fields first, then run computed/managed against the validated data ([object-validator.ts:438](../../../@warlock.js/seal/src/validators/object-validator.ts:438)).

This is genuinely novel. Zod's `.transform()` is per-field; you can't easily derive `slug` from `title` while keeping the object-level type clean. Seal makes it a first-class primitive. Cascade models lean on this for `created_by`, `updated_at`, derived slugs, etc.

### 7. Mutability model is sane

Validators are *immutable by default* — every chain method returns a clone ([base-validator.ts:91](../../../@warlock.js/seal/src/validators/base-validator.ts:91)). Toggle in-place with `.mutable`. This avoids the entire class of "I shared a schema and now my changes leaked" bugs that bite Yup users. Zod also clones; Valibot also clones; seal matches the right defaults here.

---

## Weaknesses — concrete

### 1. Type inference doesn't carry nullable / default / optional bands

[inference-types.ts:39](../../../@warlock.js/seal/src/types/inference-types.ts:39) — the `Infer<T>` mapped type:

- ✅ Reads `{ isOptional: true }` brand to mark optional keys (good)
- ❌ Does NOT widen output to `T | null` for `.nullable()` — there's no nullable brand
- ❌ Does NOT narrow `T | undefined` to `T` for `.optional().default(x)` — defaults erase optionality at runtime but not in the type
- ❌ Falls through to `unknown` for unrecognised validator types — silent type-loss instead of `never` (which would force a fix)

For comparison, Zod 4 carries all four bands (`.nullable()`, `.optional()`, `.default()`, `.catch()`) in the type system precisely. Valibot does too via its pipe metadata. ArkType is exact by construction.

**Impact.** Users get types that are wrong about nullable values, leading to runtime null checks the type system told them weren't needed. This bites hardest in Cascade models where DB columns are often nullable.

**Fix difficulty.** Medium. Requires adding brand types in [base-validator.ts](../../../@warlock.js/seal/src/validators/base-validator.ts) for `nullable()` and a different return for `.default()`, then updating `Infer<>` to read them. Plus a deprecation cycle if any downstream type assumes `string` not `string | null` after `.nullable()`.

### 2. No `lazy()` — recursive schemas are impossible

A category schema with `children: Category[]` cannot be expressed in seal. There's no way to break the chicken-and-egg of "the validator references itself". Zod/Yup/Valibot/Joi all have `lazy()` or `recursive()`. ArkType handles it via type strings.

**Impact.** Trees, threaded comments, file-system shapes, organisational hierarchies — none expressible. Users either hand-roll a type-only definition (losing runtime validation) or duplicate the structure for fixed depth.

**Fix difficulty.** Medium. `LazyValidator` wrapping a thunk, plus `Infer<>` handling for a self-referencing type alias (TS allows this with a hack — `type X = { children: X[] }` works but the inferred type name has to be declared).

### 3. No `discriminatedUnion()` — unions can't disambiguate by tag

[union-validator.ts](../../../@warlock.js/seal/src/validators/union-validator.ts) + [rules/core/union.ts](../../../@warlock.js/seal/src/rules/core/union.ts) — the union rule iterates validators, calls `matchesType()` to skip mismatched ones, then runs the first type-matching validator and stops. For a union of `v.object({type: v.literal("email"), ...})` and `v.object({type: v.literal("sms"), ...})`, *both* match `matchesType` (object) — the first one wins regardless of payload. Errors come from one branch, not the right branch.

Zod's `discriminatedUnion("type", [...])` solves this: peek at the discriminator field, route to the matching branch, report errors from that branch only. ArkType does similar. Valibot has `variant()`.

**Impact.** Polymorphic payloads (notifications, events, message types) can't be expressed cleanly. Workaround is one `when()` per discriminator value, which produces worse errors and doesn't carry into JSON Schema's `oneOf` cleanly.

**Fix difficulty.** Low–medium. New `v.discriminatedUnion(key, validators)` factory + a discriminator-aware rule. JSON Schema mapping is also cleaner — you get `oneOf` with `{ if: { properties: { type: { const: "X" }}}, then: {...} }` patterns.

### 4. Error model is thin and stringly-typed

[result-types.ts:4](../../../@warlock.js/seal/src/types/result-types.ts:4):

```ts
export type ValidationResult = {
  isValid: boolean;
  data: any;                           // ← `any`, not generic
  errors: { type: string; error: string; input: string }[];
};
```

Compare to Zod's `z.ZodError` with `issues[]` carrying `{ code, expected, received, path, message, params }` — programmatic handling is one switch on `issue.code`. Seal's `error: string` is the message, not a code; the only discriminator is `type` (the rule name) which isn't stable across versions.

`data: any` is a particular pain point. The Standard Schema bridge gets typing right via the schema's type parameter; but the *direct* `validate()` function returns `any` ([factory/validate.ts:9](../../../@warlock.js/seal/src/factory/validate.ts:9)), forcing every consumer to either cast or call through `~standard`.

**Impact.** Consumers writing form-error UIs do `errors.map(e => e.error)` and lose any chance of localized messages or per-error UI hints. Cascade and AI integration has to type-cast everything.

**Fix difficulty.** Medium-high. Generic `ValidationResult<T>` + adding rule codes (`code: "minLength" | "email" | ...`) + tightening the public API. Backward-compat shim possible but breaks anyone destructuring.

### 5. `.optional()` is missing from collection validators (until 2026-05-12)

You found this one this session. Same shape applied to other places — every validator override of `validate()` needs the same care. There's no shared scaffold for "validate as collection", so the bug recurred in 3 places independently. The fix you shipped (commit `4640b6a`) is good but doesn't extract the pattern. Next collection-shaped validator added (e.g. `v.set()`) would reproduce it.

**Fix difficulty.** Low. Refactor `RecordValidator/ArrayValidator/TupleValidator.validate()` to call a shared `validateContainer(data, context, iterate)` helper. Defensive, not urgent.

### 6. Bundle size — modular it isn't

Seal exports everything via barrel files (`validators/index.ts`, `rules/index.ts`, `mutators/index.ts`). Importing `v` from `@warlock.js/seal` pulls in:

- All 14+ validator classes (base + 13 concrete)
- All 60+ conditional methods (loaded by side-effect from `validators/index.ts:16-19`)
- All ~50 rules + all ~40 mutators
- dayjs (date validator dep)
- `@mongez/reinforcements` and `@mongez/supportive-is` (small but present)

Estimated bundle: **~30–40KB min+gzip** for the v factory + everything (haven't measured precisely, but order of magnitude). Compare:

- Valibot: **~1KB** for minimal `v.object({ name: v.string() })` (modular)
- Zod 4: **~10–15KB** typical
- Yup: **~25KB**
- Joi: **~150KB+** (heavyweight)

For frontend forms this matters — every byte you ship into the browser is a tax. Backend, doesn't.

**Fix difficulty.** High. Going modular like Valibot would mean rewriting the API surface (`v.string([v.min(3), v.email()])` instead of `v.string().min(3).email()`). Hasan would lose the chained-method ergonomics that are part of the seal identity. Probably not worth it — but worth knowing about so frontend usage gets explicit warnings or a `@warlock.js/seal-mini` carve-out if needed.

### 7. JSON Schema generation has fragile patches

[date-validator.ts:778](../../../@warlock.js/seal/src/validators/date-validator.ts:778):

```ts
const hasToDateOnly = this.dataTransformers.some((t: any) => t.toString().includes("YYYY-MM-DD"));
if (hasToDateOnly) schema.format = "date";
```

This inspects the source code of the transformer function as a string to guess the output format. **Breaks completely under any minifier** (which renames symbols and rewrites strings), and breaks if the transformer source ever changes. Should be replaced with a tag/marker on the transformer.

Other validators are cleaner about this — string-validator inspects rule names not transformer source — but the date one is a landmine waiting on the next prod build.

**Fix difficulty.** Trivial. Tag the relevant transformers with a `marker` field; check the marker in toJsonSchema.

### 8. Plugin system works in practice but the contract is bare

**Correction to an earlier draft of this section** — initial audit claimed the plugin system was unused. Wrong. Three real plugins ship from adjacent `@warlock.js/*` packages:

- **`databasePlugin`** ([core/.../database-plugin.ts](../../../@warlock.js/core/src/validation/plugins/database-plugin.ts)) — injects `.unique()` / `.exists()` / `.uniqueExceptCurrentUser` / `.uniqueExceptCurrentId` / `.existsExceptCurrentUser` / `.existsExceptCurrentId` onto `ScalarValidator` / `StringValidator` / `NumberValidator`
- **`embedValidator`** ([cascade/.../embed-validator-plugin.ts](../../../@warlock.js/cascade/src/validation/plugins/embed-validator-plugin.ts)) — adds `v.embed(Model)` / `v.embedMany(Model)` to the factory for embedded-document validation against Cascade models
- **`filePlugin`** + **`localizedPlugin`** in core — file uploads (`v.file()`) and locale-aware string validation

So the plugin system *does* real work. What survives of the original critique: the **contract is bare**. Every plugin author:

- Writes their own `Object.assign(ValidatorClass.prototype, {...})` or factory assignment
- Writes their own `declare module "@warlock.js/seal"` for type augmentation
- Pays for their own discoverability (no introspection like "which plugins added `.unique()`?")
- Never implements `uninstall` (none of the three observed do)

That's fine when 3-4 plugins ship from the same monorepo with shared review. **It won't scale to a public ecosystem of third-party plugins** — author A's plugin and author B's plugin can collide on the same method name silently, and there's no contract for resolving the conflict. Plugin dependencies aren't tracked (if `cascade-plugin` requires `database-plugin` installed first, that's an ordering bug nobody enforces).

**Recommendation.** Either:

- **Keep as-is** and explicitly position the plugin system as "first-party extension mechanism for `@warlock.js/*` packages" (document the limitation; close to public-third-party use cases)
- **Or formalise** the contract (typed augmentation helper, dependency declarations, conflict detection, optional namespacing) before opening it up to a wider ecosystem

Neither is urgent. The current shape is fine for current usage.

### 9. Pipeline edge cases not enforced

A few small things found while reading:

- `naive split('.')` in the standard-schema bridge ([map-result.ts:29](../../../@warlock.js/seal/src/standard-schema/map-result.ts:29)) — keys with literal dots would split incorrectly into wrong path segments
- `union` rule routes by `String(fieldValue)` for discriminator lookup ([when.ts:24](../../../@warlock.js/seal/src/rules/core/when.ts:24)) — `String(true) === "true"` works, but objects/arrays as discriminators silently misroute
- Date rules re-wrap input with `new Date(value)` even when already a `Date` ([date.ts:34, 72, 145, ...](../../../@warlock.js/seal/src/rules/date/date.ts:34)) — wasted allocations on every validation pass; cumulative cost on hot paths
- `errors[].input` is poorly named — it's actually a path-or-key. "input" suggests the user-supplied value. Should be `path` or `key` on a major version bump
- `unknownKeyRule` does `O(n*m)` filter ([common/unknown-key.ts:17](../../../@warlock.js/seal/src/rules/common/unknown-key.ts:17)) — fine for small objects, slow for huge ones. Could use a Set

None of these is critical individually. Together they hint that the package is at "v1 plus polish" stage — battle-tested in some places, untested in others.

---

## Cost reality check

Per the always-consider-cost rule, things to surface explicitly:

**Bundle.** ~30–40KB to the frontend per page that imports `v`. If Warlock.js apps deliver SSR HTML and only use seal server-side, this is irrelevant. If they ship `v` to the browser (form validation on the client), it's a meaningful tax. Need a measurement. **Recommendation:** if frontend validation becomes a use case, add a `@warlock.js/seal-mini` with just `v.object/string/number/boolean` and the rules (no dates, no conditionals, no methods).

**Runtime.** Each validator call walks rules sequentially, awaits each. For a 10-field form that's fine. For batch APIs validating 10k rows server-side, the `await Promise.all(keys.map(async ...))` model in object-validator allocates a lot of promises per row; `firstErrorOnly: true` (default) caps this. Worth a benchmark before claiming "fast".

**Date dep.** dayjs is ~7KB. If the app already uses dayjs (Warlock.js does for chat timestamps etc.), the marginal cost is zero. If not, this is the single biggest seal-imposed cost. Could be made optional via lazy import — current `import dayjs from "dayjs"` at module-top forces it on every consumer.

**i18n configuration.** No measurement cost — just configuration verbosity. The 3-tier priority resolution per error means more lookups per error than competitors. For thousands of errors per request (huge form failures), measurable. Not in practice.

---

## Strategic recommendation

The honest framing: **seal is a strong domain-specific tool that's mispositioned as a general-purpose alternative to Zod**.

If you keep marketing it as "framework-agnostic Zod alternative" (the README's current pitch), the comparison is unfavourable on bundle, types, and ecosystem. If you reposition it as "**the form, API, and AI-tooling validator for Warlock.js stack — Laravel-grade conditionals, Standard Schema-ready, i18n out of the box**", every weakness becomes acceptable scope and every strength is a moat.

### Recommended priorities

**Tier 1 — fix the type system gap.** The fact that `.nullable()` doesn't show up in `Infer<>` is the single highest-impact correction. Users *think* their types are right and they aren't. Six weeks of effort tops; pays dividends forever.

**Tier 2 — add discriminatedUnion + lazy.** These two unlock real schema patterns (events, trees, threaded data). Both are small features in isolation, but they're the most-cited "missing in seal" complaints from any TS-validator user.

**Tier 3 — error model overhaul.** Rich `code` + structured issues + generic `ValidationResult<T>`. Breaking change but worth it; can be released as `seal v2`. Until then, document the limitation and recommend Standard Schema bridge for typed access.

**Tier 4 — formalise the plugin contract (if you ever open up to third-party plugins).** Right now the system works for first-party `@warlock.js/*` plugins (database, embed, file, localized) but the contract is bare. If/when public plugin authorship matters, invest in typed augmentation + conflict detection. Not urgent.

**Tier 5 — measure the bundle.** Don't guess. Run `bundlephobia` / `bundlejs.com` numbers. If frontend usage is a real path, plan a modular carve-out.

**Don't bother.** Going Valibot-style fully modular. The chained API IS the seal identity and rewriting it loses more than it gains.

### What this analysis is NOT

- It's not a benchmark. No perf numbers.
- It's not exhaustive. I read the source, not every rule file. ~80% coverage of the package by LoC.
- It's not a market survey. Stars, downloads, ecosystem-health were not measured.
- It's not normative. Hasan owns the call on every recommendation. This is signal, not direction.

Refresh this doc when seal lands a major change (next type-system pass, error overhaul, etc.) or when a competitor lands one (Zod 5, Valibot 1.0 stable, ArkType 2).

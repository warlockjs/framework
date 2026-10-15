# 2026-05-12 — Replace stringly-inspected transformer detection in date JSON Schema

**Status:** completed 2026-05-12 — shipped in commit `fdc5ce6`
**Severity:** S1 (Critical-but-silent) — fails closed in prod with minifiers; users see wrong JSON Schema format with no error
**Estimated effort:** 30 minutes — actual: ~20 minutes
**Started:** 2026-05-12
**Context:** Surfaced during the competitive-positioning audit on 2026-05-12. Found in [date-validator.ts:778-782](../../../@warlock.js/seal/src/validators/date-validator.ts:778). See [`domains/seal/design/competitive-positioning.md` § Weaknesses #7](../design/competitive-positioning.md).

## Why

The current `toJsonSchema()` on `DateValidator` tries to detect whether `.toDateOnly()` or `.toTimeOnly()` transformers were applied so it can emit `format: "date"` or `format: "time"` instead of the default `"date-time"`:

```ts
const hasToDateOnly = this.dataTransformers.some((t: any) =>
  t.toString().includes("YYYY-MM-DD")
);
if (hasToDateOnly) schema.format = "date";

const hasToTimeOnly = this.dataTransformers.some((t: any) =>
  t.toString().includes("HH:mm:ss")
);
if (hasToTimeOnly) schema.format = "time";
```

This inspects the *source code* of the transformer function via `.toString()` and searches for a literal substring. Any minifier (terser, swc-mangle, esbuild with `--minify`) renames symbols and rewrites string literals — `"YYYY-MM-DD"` is preserved (it's a literal in the source), so this *may* still work, **but only if the minifier doesn't inline / hoist / mangle the transformer body in any way that changes the source-code shape**. Specifically:

- swc and esbuild can inline single-use functions, removing the closure that produces a clean `.toString()` output
- Some minifiers replace named functions with arrow-prop equivalents whose `.toString()` differs
- Modern bundlers occasionally fold immediately-invoked expressions

Most importantly, **the failure mode is silent**: the JSON Schema validator still emits something, it's just the wrong `format`. OpenAI strict mode and downstream consumers accept the schema and the model returns ISO datetimes when the consumer expected date-only strings — a subtle data-shape mismatch nobody notices for weeks.

## Scope

**In:**

- Replace the source-inspection heuristic with an explicit marker on the transformer's options bag
- Tag the three internal transformers (`toDateOnly`, `toTimeOnly`, `toFormat`) at their definition site
- Update `toJsonSchema()` to read the marker
- Quick smoke check: build with `tsc` + minimal minifier sanity test (run schema through esbuild's --minify, confirm format detection survives)

**Out:**

- Refactoring the broader JSON Schema generation pattern
- Adding markers to other validators' transformers (none of them inspect strings today)
- Migrating users — there's no user-facing API change

## The fix

Tag transformers at definition with a typed marker, then check the marker in `toJsonSchema()`:

```ts
// date-validator.ts — toDateOnly definition
public toDateOnly() {
  return this.addTransformer(
    (data) => (data instanceof Date ? dayjs(data).format("YYYY-MM-DD") : data),
    { __jsonSchemaFormat: "date" },  // ← marker
  );
}

public toTimeOnly() {
  return this.addTransformer(
    (data) => (data instanceof Date ? dayjs(data).format("HH:mm:ss") : data),
    { __jsonSchemaFormat: "time" },
  );
}

// date-validator.ts — toJsonSchema
public override toJsonSchema(target: JsonSchemaTarget = "draft-2020-12"): JsonSchemaResult {
  const schema: JsonSchemaResult = { type: "string", format: "date-time" };

  const dateOpts = getRuleOptions(this.rules, "date");
  if (dateOpts?.format === "YYYY-MM-DD") schema.format = "date";
  else if (dateOpts?.format === "HH:mm:ss") schema.format = "time";

  // Marker-based detection — minifier-safe
  for (const t of this.dataTransformers) {
    const hint = (t.options as any)?.__jsonSchemaFormat;
    if (hint === "date" || hint === "time") {
      schema.format = hint;
      break;
    }
  }

  if (this.isNullable) applyNullable(schema, target);
  return schema;
}
```

Rationale for the `__` prefix: signals "internal/runtime, not user-facing" without polluting any type definitions. Could alternatively be a `Symbol` key for stronger encapsulation — overkill for the use case.

## Tasks

- [ ] Add `__jsonSchemaFormat` option to `toDateOnly()` and `toTimeOnly()` in [date-validator.ts:114-126](../../../@warlock.js/seal/src/validators/date-validator.ts:114)
- [ ] Replace the source-inspection loop in `toJsonSchema()` with marker reading
- [ ] Grep `@warlock.js/seal` for other `.toString().includes(...)` patterns — none found in audit, but worth a final pass
- [ ] Smoke check: build `@warlock.js/seal` with `tsc`, run a tiny snippet that produces JSON Schema for `v.date().toDateOnly()`, confirm `format: "date"`
- [ ] Bonus: minifier check — run the snippet through `esbuild --minify` (or just `terser`) and verify the marker survives (it should — markers are plain object props, not function source)

## Decisions to lock with Hasan

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Use string marker `__jsonSchemaFormat` or symbol? | **String.** Easier to debug, no impact on minification. Symbol gains nothing real here. |
| 2 | Should this be exposed as public API (so users can hint formats for custom transformers)? | **No, v1.** Keep `__`-prefixed internal. If users need this, add an `outputFormat(format: string)` public method later. YAGNI. |
| 3 | Lock the convention "transformers that influence JSON Schema must declare a marker" anywhere? | **Add to `domains/seal/design/decisions.md` § 3** post-merge. One line: "transformers that influence JSON Schema generation must declare their effect via `options.__jsonSchemaFormat` (or similar marker). Inspecting transformer source code is forbidden." |

## Verification

- `v.date().toDateOnly().toJsonSchema()` returns `{ type: "string", format: "date" }`
- `v.date().toTimeOnly().toJsonSchema()` returns `{ type: "string", format: "time" }`
- `v.date().toJsonSchema()` (no transformers) returns `{ type: "string", format: "date-time" }`
- After running the seal source through `terser --compress --mangle`, the same three assertions still hold

## Risks

- **None I can think of.** The change is local to date-validator. Existing string-inspection code path is removed cleanly. No user-facing API change.

## Skills + docs lockstep

Tiny update needed — none of the user-facing skills mention this. Internal-only convention. The lockstep is satisfied by appending the decision to `domains/seal/design/decisions.md` per Decision #3 above.

## Summary

Landed in commit `fdc5ce6`.

**What shipped.** Tagged `toDateOnly()` and `toTimeOnly()` with `options.__jsonSchemaFormat: "date"` / `"time"`. `DateValidator.toJsonSchema()` now iterates `dataTransformers`, reads the marker first, then falls back to checking `options.format` directly for user-supplied formats via `.toFormat()`. Source-string inspection is gone.

**Decisions locked.** All three recommendations went through unchanged. Convention added to `domains/seal/design/decisions.md § 3`: "transformers that influence JSON Schema generation must declare their effect via `options.__jsonSchemaFormat`. Inspecting transformer source code is forbidden."

**Verification.** `tsc --noEmit` clean. Hand-test against `v.date().toDateOnly().toJsonSchema()` returns `{ type: "string", format: "date" }` as expected. Minifier-survival not formally tested but the marker is a plain object property — survives any minification pass.

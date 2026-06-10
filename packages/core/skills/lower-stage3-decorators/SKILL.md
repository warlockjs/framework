---
name: lower-stage3-decorators
description: 'Vite/Vitest plugin `lowerStage3Decorators()` that lowers TC39 Stage-3 (native) decorators with esbuild before oxc / the SSR rewrite mangles them — so `@RegisterModel`-decorated Cascade models load under Vitest 4 / Vite 8. Triggers: `lowerStage3Decorators`, "SyntaxError: Invalid or unexpected token" on a decorated class, "@(0, __vite_ssr_import__.X)()", "decorator crashes vitest", "models won''t load in tests", "Vite 8 oxc decorators"; typical import `import { lowerStage3Decorators } from "@warlock.js/core"` in `vite.config.ts` / `vitest.config.ts`. Skip: writing the tests themselves — `@warlock.js/core/test-service/SKILL.md` / `@warlock.js/core/test-http/SKILL.md`; runtime migrations — `@warlock.js/cascade/write-migration/SKILL.md`.'
---

# Lower Stage-3 decorators for Vite/Vitest

Cascade declares relations with **native** decorators — `@RegisterModel`, `@BelongsTo`, `@HasMany`. Under Vitest 4 / Vite 8 those crash on load:

```
SyntaxError: Invalid or unexpected token
```

The cause is two transforms that don't understand each other. Vite 8 transpiles `.ts` with **oxc**, which only lowers *legacy* (`experimentalDecorators`) decorators — it leaves native ones in place. Then Vite's SSR `moduleRunnerTransform` rewrites the decorator's imported name into `@(0, __vite_ssr_import__.RegisterModel)()` — which is no longer valid decorator syntax. V8 throws on the first decorated model it evaluates, and your whole suite is dead before a single test runs.

`lowerStage3Decorators()` fixes it by getting **esbuild** to lower the decorators *first*.

## Use it

Drop it **first** in your `plugins` array:

```ts title="vite.config.ts"
import { lowerStage3Decorators } from "@warlock.js/core";
import mongezVite from "@mongez/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [lowerStage3Decorators(), mongezVite()],
  test: {
    environment: "node",
    include: ["src/app/**/*.test.ts"],
  },
});
```

That's the whole fix. Any file that imports a decorated model now loads.

## Why it works

The plugin runs `enforce: "pre"`, so it executes **ahead of** Vite's core transform and the SSR rewrite. For every `.ts`/`.tsx` file that actually contains a decorator it runs esbuild with `target: "es2022"` and `experimentalDecorators: false` — esbuild lowers the Stage-3 decorator into a plain helper call (no `@` left), preserving the `(value, context)` runtime semantics the decorators depend on. By the time oxc and the SSR step see the file, there's no decorator syntax left to mangle — just ordinary import references.

It's the **same esbuild transform the production `tsx`/build path uses**, so a file lowered in tests behaves identically in dev and prod. Two cheap gates keep the fast path fast: files in `node_modules`, non-TypeScript files, and files with no `@decorator` are skipped entirely and never pay esbuild's cost.

## Things NOT to do

- **Don't reach for `oxc: { target: "es2022" }`** — it's insufficient. oxc can only lower *legacy* decorators, and the breakage is the SSR rewrite, not the transpile target. Legacy lowering would also mangle the Stage-3 `(value, context)` signature.
- **Don't put it after `@mongez/vite`** — it must run `pre`, before any other transform. Keep it first.
- **Don't set `experimentalDecorators: true`** anywhere in the test tsconfig — Cascade's decorators are native (Stage-3), not legacy. Legacy mode changes their call signature and breaks `context.kind` / `context.metadata`.

## See also

- [`@warlock.js/core/test-service/SKILL.md`](@warlock.js/core/test-service/SKILL.md) — `setupTest()` bootstrap for unit-testing services/models once the harness loads.
- [`@warlock.js/core/test-http/SKILL.md`](@warlock.js/core/test-http/SKILL.md) — integration tests over the real HTTP server.
- [`@warlock.js/cascade/write-migration/SKILL.md`](@warlock.js/cascade/write-migration/SKILL.md) — the decorated models this plugin lets you load.

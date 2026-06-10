import { transform } from "esbuild";

/**
 * The Vite/Vitest plugin object returned by {@link lowerStage3Decorators}.
 *
 * Declared structurally so `@warlock.js/core` needn't take a `vite` dependency
 * just for one type — the shape is assignable to Vite's `PluginOption` wherever
 * it's placed in a config's `plugins` array.
 */
export interface DecoratorLoweringPlugin {
  name: string;
  enforce: "pre";
  transform(code: string, id: string): Promise<{ code: string; map: string } | null>;
}

/**
 * Vite/Vitest plugin that lowers TC39 Stage-3 (native) decorators to plain JS
 * **before** the rest of the transform pipeline runs.
 *
 * Cascade models declare relations with native decorators (`@RegisterModel`,
 * `@BelongsTo`, `@HasMany`, …). Vitest's bundled rolldown-vite transforms `.ts`
 * with **oxc**, and Vite's SSR `moduleRunnerTransform` rewrites the decorator's
 * import reference into `@(0, __vite_ssr_import__.RegisterModel)()` — invalid
 * decorator syntax that throws "SyntaxError: Invalid or unexpected token" on
 * every model load. oxc can only lower *legacy* decorators, and legacy lowering
 * would mangle the Stage-3 `(value, context)` signature these decorators rely on
 * (they read `context.kind` / `context.metadata`).
 *
 * esbuild lowers Stage-3 decorators correctly while preserving their runtime
 * semantics — the same transform the production `tsx`/build path uses, so a file
 * lowered here behaves identically in dev, test, and prod. Running `enforce:
 * "pre"` hands oxc / the SSR rewrite already-lowered, decorator-free code. Files
 * with no decorator skip esbuild entirely, so the fast path is untouched.
 *
 * Keep it **first** in the `plugins` array so it runs ahead of `@mongez/vite`
 * and Vite's core transform.
 *
 * @example
 * ```ts
 * // vite.config.ts / vitest.config.ts
 * import { lowerStage3Decorators } from "@warlock.js/core";
 * import { defineConfig } from "vitest/config";
 *
 * export default defineConfig({
 *   plugins: [lowerStage3Decorators(), mongezVite()],
 * });
 * ```
 */
export function lowerStage3Decorators(): DecoratorLoweringPlugin {
  return {
    name: "warlock:lower-stage3-decorators",
    enforce: "pre",
    async transform(code, id) {
      const [filepath] = id.split("?");

      if (!/\.tsx?$/.test(filepath) || filepath.includes("/node_modules/")) {
        return null;
      }

      // Cheap gate: only files that actually carry a decorator pay esbuild's cost.
      if (!/(^|\n)\s*@[A-Za-z_$]/.test(code)) {
        return null;
      }

      const result = await transform(code, {
        loader: filepath.endsWith(".tsx") ? "tsx" : "ts",
        format: "esm",
        target: "es2022",
        sourcemap: true,
        sourcefile: filepath,
        // Force native (Stage-3) semantics regardless of any ambient tsconfig
        // esbuild might otherwise honor.
        tsconfigRaw: { compilerOptions: { experimentalDecorators: false } },
      });

      return { code: result.code, map: result.map };
    },
  };
}

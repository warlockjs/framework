import { transform } from "esbuild";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

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

type JsxCompilerOptions = {
  jsx?: string;
  jsxImportSource?: string;
  jsxFactory?: string;
  jsxFragmentFactory?: string;
};

/** Parse a tsconfig file's JSON, tolerating comments and trailing commas. */
function readTsconfig(file: string): Record<string, any> | undefined {
  try {
    const text = readFileSync(file, "utf8")
      .replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (_, string) => string ?? "")
      .replace(/,(\s*[}\]])/g, "$1");

    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The JSX options of a tsconfig, following relative `extends` chains. */
function jsxOptionsOf(file: string, depth = 0): JsxCompilerOptions {
  const config = readTsconfig(file);

  if (!config) return {};

  let inherited: JsxCompilerOptions = {};

  if (typeof config.extends === "string" && config.extends.startsWith(".") && depth < 5) {
    const parent = resolve(dirname(file), config.extends);
    const parentFile = existsSync(parent) ? parent : `${parent}.json`;

    inherited = jsxOptionsOf(parentFile, depth + 1);
  }

  const own = config.compilerOptions ?? {};
  const picked: JsxCompilerOptions = {};

  for (const key of ["jsx", "jsxImportSource", "jsxFactory", "jsxFragmentFactory"] as const) {
    if (typeof own[key] === "string") picked[key] = own[key];
  }

  return { ...inherited, ...picked };
}

const jsxOptionsByDirectory = new Map<string, JsxCompilerOptions>();

/**
 * The JSX settings of the project a file belongs to: the nearest `tsconfig.json` upward from
 * the file, with its `extends` chain. A project without any `jsx` setting gets the automatic
 * runtime, so a component never needs `React` in scope.
 */
export function resolveJsxOptions(filepath: string): JsxCompilerOptions {
  const directory = dirname(filepath);
  const cached = jsxOptionsByDirectory.get(directory);

  if (cached) return cached;

  let current = directory;
  let found: JsxCompilerOptions = {};

  for (;;) {
    const candidate = resolve(current, "tsconfig.json");

    if (existsSync(candidate)) {
      found = jsxOptionsOf(candidate);
      break;
    }

    const parent = dirname(current);

    if (parent === current) break;

    current = parent;
  }

  const resolved = { jsx: "react-jsx", ...found };

  jsxOptionsByDirectory.set(directory, resolved);

  return resolved;
}

/**
 * Remove comments and string / template text from source, keeping the code inside
 * template `${...}` expressions, so a decorator check never matches an `@` that is
 * only text (a CSS `@media` rule in a template string, `@param` in a comment).
 */
export function stripNonCode(code: string): string {
  let output = "";
  // for every open template literal, the brace depth at which its `${` was opened
  const templates: number[] = [];
  let depth = 0;
  let index = 0;

  while (index < code.length) {
    const char = code[index]!;
    const next = code[index + 1];
    const inTemplateText = templates.length > 0 && templates[templates.length - 1] === -1;

    if (inTemplateText) {
      if (char === "\\") index += 2;
      else if (char === "`") {
        templates.pop();
        index += 1;
      } else if (char === "$" && next === "{") {
        templates[templates.length - 1] = depth;
        depth += 1;
        index += 2;
      } else index += 1;

      continue;
    }

    if (char === "/" && next === "/") {
      while (index < code.length && code[index] !== "\n") index += 1;
    } else if (char === "/" && next === "*") {
      const end = code.indexOf("*/", index + 2);

      output += " ";
      index = end === -1 ? code.length : end + 2;
    } else if (char === '"' || char === "'") {
      index += 1;

      while (index < code.length && code[index] !== char && code[index] !== "\n") {
        index += code[index] === "\\" ? 2 : 1;
      }

      // Skip the closing quote, but keep a newline that ended an unclosed one (an
      // apostrophe in JSX text, a quote in a regex) so the next line still starts a line.
      if (code[index] === char) index += 1;
      output += '""';
    } else if (char === "`") {
      templates.push(-1);
      output += '""';
      index += 1;
    } else {
      if (char === "{") depth += 1;

      if (char === "}") {
        depth -= 1;

        if (templates.length > 0 && templates[templates.length - 1] === depth) {
          // back to the template text after a `${...}`
          templates[templates.length - 1] = -1;
          index += 1;
          continue;
        }
      }

      output += char;
      index += 1;
    }
  }

  // An unterminated template means the scan lost its place (a stray backtick in JSX text,
  // for instance). Stay on the safe side and let the file be checked as written.
  return templates.length > 0 ? code : output;
}

const PLUGIN_NAME = "warlock:lower-stage3-decorators";

let instances = 0;

/**
 * The first instance in a process keeps the plain name. Any later one gets a
 * numbered name, because Vitest 5 counts plugins by name and warns
 * `applies the same plugin multiple times` when an inline project lists the
 * plugin its root config already declares.
 *
 * The extra instance is deliberately not switched off: when the project does
 * not inherit the root config (`extends: false`) it is the only one that
 * reaches the project, and it must lower decorators there. Running twice is
 * safe, as a lowered module carries no decorator left for the second pass and
 * the cheap gate returns before esbuild is called.
 */
function nextPluginName(): string {
  instances += 1;

  return instances === 1 ? PLUGIN_NAME : `${PLUGIN_NAME}#${instances}`;
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
 * Calling it more than once in one process is safe (a root config plus an
 * inline project, for example): later instances are named distinctly, so Vitest
 * does not warn about a duplicated plugin, and they skip modules that carry no
 * decorator any more.
 *
 * Keep it **first** in the `plugins` array so it runs ahead of `@mongez/vite`
 * and Vite's core transform.
 *
 * @example
 * ```ts
 * // vite.config.ts / vitest.config.ts
 * import { lowerStage3Decorators } from "@warlock.js/core/vite";
 * import { defineConfig } from "vitest/config";
 *
 * export default defineConfig({
 *   plugins: [lowerStage3Decorators(), mongezVite()],
 * });
 * ```
 */
export function lowerStage3Decorators(): DecoratorLoweringPlugin {
  return {
    name: nextPluginName(),
    enforce: "pre",
    async transform(code, id) {
      const [filepath] = id.split("?");

      // `split` always yields a first element, so this holds. Returning `null`
      // — the plugin's own "not my file" answer — rather than defaulting:
      // `?? ""` would fail the `.tsx?` test and reach the same outcome by
      // accident, and a transform plugin that guesses at a module id is how a
      // file silently skips decorator lowering and fails at runtime instead.
      if (filepath === undefined) return null;

      if (!/\.tsx?$/.test(filepath) || filepath.includes("/node_modules/")) {
        return null;
      }

      // Cheap gate: only files that actually carry a decorator pay esbuild's cost.
      // Strings, template text and comments are blanked first: a CSS `@media` line in a
      // template string is not a decorator.
      if (!/(^|\n)\s*@[A-Za-z_$]/.test(stripNonCode(code))) {
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
        // The project's own JSX settings ride along: this transform replaces the one that
        // would otherwise read them, and esbuild's default is the classic runtime.
        tsconfigRaw: {
          compilerOptions: { ...resolveJsxOptions(filepath), experimentalDecorators: false },
        } as never,
      });

      return { code: result.code, map: result.map };
    },
  };
}

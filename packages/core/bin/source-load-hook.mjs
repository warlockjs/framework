/**
 * The TypeScript `load` hook `bin/warlock.js` registers when `@warlock.js/core`
 * runs from source (no `esm/` build next to the bin).
 *
 * It runs on Node's loader worker thread (`module.register()`), not in the
 * main thread (`module.registerHooks()`), and that placement is the fix for a
 * real crash, not a style choice. On Node 22.15, an in-thread `load` hook makes
 * the ESM loader hand every imported CommonJS file its source, which puts that
 * file in `require.cache` while the module graph is still being linked but
 * before it has run. A CommonJS package that `require()`s the same file in
 * that window gets its empty, unfilled `exports` object instead of the real
 * value. Core's own graph has exactly that shape: the scheduler imports
 * `dayjs/plugin/utc.js` and `dayjs/plugin/timezone.js`, and
 * `@mongez/time-wizard` `require()`s both, so every booting command
 * (`doctor`, `inspect`, `mcp`, `routes`) died in `bootstrap()` with
 * `TypeError: t is not a function` from `dayjs.extend`. Node 26.3 does not
 * have the defect; a worker-thread hook does not trigger it on either.
 *
 * Non-TypeScript URLs (npm `.js`, `node:` builtins, JSON) fall through to the
 * next loader untouched. When the dev server registers its own loader later,
 * that loader's hooks run before this one (later registrations run first), so
 * it owns the TypeScript path from then on and this hook is never reached for
 * a `.ts` file again.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const TS_FILE = /\.(ts|tsx|mts|cts)$/;
const VERSION_QUERY = /\?v=\d+$/;

/** Set by `initialize()` from the `data` the bin passes to `register()`. */
let transpileOptions = { target: "node22", tsconfigRaw: "{}" };

/**
 * Receive the transpile options from the main thread.
 *
 * @param {{ target: string, tsconfigRaw: string }} data
 */
export function initialize(data) {
  transpileOptions = data;
}

/**
 * Transpile TypeScript with esbuild; pass everything else down the chain.
 */
export async function load(url, context, nextLoad) {
  const cleanUrl = url.replace(VERSION_QUERY, "");

  if (!TS_FILE.test(cleanUrl)) return nextLoad(url, context);

  const absolutePath = fileURLToPath(cleanUrl);
  const { code } = transformSync(readFileSync(absolutePath, "utf8"), {
    loader: absolutePath.endsWith(".tsx") ? "tsx" : "ts",
    format: "esm",
    target: transpileOptions.target,
    sourcefile: absolutePath,
    sourcemap: "inline",
    tsconfigRaw: transpileOptions.tsconfigRaw,
  });

  return { format: "module", source: code, shortCircuit: true };
}

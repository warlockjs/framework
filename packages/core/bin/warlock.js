#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 15)) {
  console.error(`[warlock] requires Node 22.15 or newer (running ${process.versions.node}).`);
  process.exit(1);
}

// Bun and Deno report the Node version they emulate in `process.versions.node`
// and add their own entry, so the check above passes on both. `warlock dev` is
// the one command that cannot run there (it is built on Node's module loader
// hooks), and it is refused here, before anything loads, so the refusal reads
// the same whether the CLI runs from published output or from source. The
// `dev` command repeats this check for callers that bypass this file.
const foreignRuntimeName = process.versions.bun
  ? "Bun"
  : process.versions.deno
    ? "Deno"
    : undefined;

if (foreignRuntimeName && process.argv[2] === "dev") {
  const foreignRuntime = `${foreignRuntimeName} ${process.versions.bun ?? process.versions.deno}`;
  const start = process.versions.bun ? "bun dist/app.js" : "deno run -A dist/app.js";

  console.error(
    [
      `✖ warlock dev runs on Node.js only — this process is ${foreignRuntime}.`,
      "  The development server compiles TypeScript and hot-reloads modules through Node's module loader hooks.",
      "  Run it with Node.js 22.15 or newer: npx warlock dev",
      `  ${foreignRuntimeName} can run the production build: build it with Node (npx warlock build),`,
      `  then start it with ${start}.`,
      "  Supported runtimes: https://warlock.js.org/v/latest/core/digging-deeper/supported-runtimes/",
    ].join("\n"),
  );
  process.exit(1);
}

const binDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The published package ships compiled ESM next to this file; a source
 * checkout (this monorepo, or anyone consuming `@warlock.js/core` straight
 * from git) has only TypeScript. `main` in package.json already points at
 * `./src/index.ts`, so "consumed as source" is the supported layout — the bin
 * has to honour it too instead of assuming build output exists.
 */
const publishedEntry = path.join(binDir, "..", "esm", "cli", "start.mjs");

if (existsSync(publishedEntry)) {
  // One `stat` is the entire cost the published path pays. No loader is
  // registered, nothing is transpiled, esbuild is never even imported.
  await import(pathToFileURL(publishedEntry).href);
} else {
  await bootFromSource();
}

/**
 * Register a TypeScript loader, then hand off to the TS CLI entry.
 *
 * Why a bootstrap loader at all, when core already owns one under
 * `src/dev-server/loader/`? Because that loader is itself TypeScript and is
 * registered by `registerLoader()`, which can only be reached through a TS
 * import — the chicken-and-egg. It also wants things a bare `warlock --help`
 * has no business producing: a `.warlock/` directory in the user's cwd, a
 * bundled hook worker, a transpile cache and a MessageChannel for HMR bumps.
 *
 * So this is deliberately the *smaller* half of that machinery, and it reuses
 * rather than reimplements the part that actually encodes framework
 * behaviour: resolution. The sequence below is what makes that possible.
 */
async function bootFromSource() {
  const sourceEntry = path.join(binDir, "..", "src", "cli", "start.ts");

  if (!existsSync(sourceEntry)) {
    console.error(
      "[warlock] Neither esm/cli/start.mjs nor src/cli/start.ts was found next to " +
        `${binDir}. The @warlock.js/core installation looks incomplete.`,
    );
    process.exit(1);
  }

  const { registerHooks } = await import("node:module");

  // Bun has no `module.registerHooks`. Only a source checkout reaches this
  // path (published packages ship compiled output), so say what is missing
  // instead of failing on "registerHooks is not a function".
  if (typeof registerHooks !== "function") {
    console.error(
      "[warlock] Running @warlock.js/core from TypeScript source needs Node's module.registerHooks " +
        "(Node 22.15 or newer); this runtime does not provide it. Use Node, or install the published package.",
    );
    process.exit(1);
  }

  const { register } = await import("node:module");
  const { getTsconfig, resolvePathAlias } = await import("get-tsconfig");

  // Same target the dev loader and the production builder pin, so a file
  // transpiled here lowers TC39 decorators to the same helper output it would
  // get anywhere else in the toolchain. Drifting from it would make the CLI a
  // third, subtly different dialect.
  const TRANSPILE_TARGET = "node22";

  // Read from cwd, not from core: `jsx`, `experimentalDecorators` and friends
  // are the *app's* call, and this is the same source of truth the dev
  // loader's resolve hook reads.
  const tsconfig = getTsconfig(process.cwd());
  const tsconfigRaw = JSON.stringify({
    compilerOptions: tsconfig?.config?.compilerOptions ?? {},
  });

  /**
   * Handover switch for the in-thread `resolve` hook below. Verified
   * behaviour: in-thread hooks run *before* `register()` worker hooks and
   * delegate down the chain, so once the dev server registers its own loader
   * this hook would still resolve every `.ts` first and short-circuit,
   * bypassing the dev loader's `?v=N` HMR stamping.
   *
   * Setting `active = false` makes it a pure pass-through. `registerLoader()`
   * should flip it just before it calls `register()`; until it does, this
   * hook stays in charge, which is the correct default for every non-dev
   * command. (The `load` hook needs no switch: it is a worker hook, and the
   * dev loader's worker hooks, registered later, run before it.)
   */
  const bootstrapLoader = { active: true };
  globalThis.__warlockBootstrapLoader = bootstrapLoader;

  /**
   * `load` hook — transpiles TypeScript with esbuild. It runs on Node's
   * loader worker thread (`register()`), NOT in this thread
   * (`registerHooks()`): on Node 22.15 an in-thread `load` hook makes a
   * CommonJS package that `require()`s a file which an ES module also imports
   * receive that file's empty, not-yet-run `exports`, which crashed every
   * booting command inside `dayjs.extend`. See `source-load-hook.mjs`.
   */
  register(pathToFileURL(path.join(binDir, "source-load-hook.mjs")).href, {
    data: { target: TRANSPILE_TARGET, tsconfigRaw },
  });

  // Stage 2 — the reuse. With `load` live, core's own resolver can be pulled
  // in as TypeScript. It is imported by exact absolute path on purpose: it is
  // a leaf module whose only import is `node:url`, so it needs no extension
  // probing to load, which is precisely the thing we don't have yet.
  const { ownResolve, probeFile } = await import(
    pathToFileURL(path.join(binDir, "..", "src", "dev-server", "loader", "own-resolver.ts")).href
  );

  let pathsMatcher = null;
  if (tsconfig) {
    pathsMatcher = (specifier) => resolvePathAlias(tsconfig, specifier);
  }

  /**
   * `resolve` hook — a thin sync wrapper over `ownResolve`, which owns
   * tsconfig `paths` plus TS extension/index probing. Everything it returns
   * `null` for (bare npm, `node:`, `file:`) falls through to Node's default,
   * which keeps `exports`/`node_modules` semantics intact.
   *
   * One fallback on top: a bare subpath of a package consumed as source, such
   * as `@warlock.js/core/net` (imported by `@warlock.js/ai`). Core declares no
   * `exports` map in source form, so Node's default resolver lands on the
   * `net/` directory and refuses it (`ERR_UNSUPPORTED_DIR_IMPORT`); the
   * published package maps the subpath to its built entry instead. The
   * directory's `index.ts` is what TypeScript and vitest resolve the same
   * specifier to, so that is what this resolves it to as well.
   *
   * The dev loader's version of this also stamps `?v=N` for HMR. That is
   * deliberately absent: the CLI process has no watcher, and the dev server
   * registers its own full loader when it boots.
   */
  function resolve(specifier, context, nextResolve) {
    const owned = bootstrapLoader.active
      ? ownResolve(specifier, context.parentURL, pathsMatcher, existsSync)
      : null;

    // Producing the URL ourselves means `nextResolve` was never called, so the
    // chain has to be short-circuited explicitly or Node raises
    // ERR_LOADER_CHAIN_INCOMPLETE.
    if (owned) return { url: owned, shortCircuit: true };

    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const index = bootstrapLoader.active ? directoryIndexOf(error) : null;

      if (index) return { url: index, shortCircuit: true };

      throw error;
    }
  }

  /**
   * The `index.ts` (or `.tsx`/`.js`/`.jsx`) inside the directory Node refused
   * to import, as a `file:` URL, or `null` when the error is anything else.
   */
  function directoryIndexOf(error) {
    if (error?.code !== "ERR_UNSUPPORTED_DIR_IMPORT" || typeof error.url !== "string") return null;

    const directory = fileURLToPath(error.url).replace(/\\/g, "/").replace(/\/$/, "");
    const hit = probeFile(`${directory}/index`, existsSync);

    return hit ? pathToFileURL(hit).href : null;
  }

  registerHooks({ resolve });

  // The transpile above emits inline maps; without this they'd be dead weight
  // and every CLI stack trace would point at generated line numbers.
  process.setSourceMapsEnabled(true);

  await import(pathToFileURL(sourceEntry).href);
}

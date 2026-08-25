#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  const { readFileSync } = await import("node:fs");
  const { transformSync } = await import("esbuild");
  const { getTsconfig, resolvePathAlias } = await import("get-tsconfig");

  // Same target the dev loader and the production builder pin, so a file
  // transpiled here lowers TC39 decorators to the same helper output it would
  // get anywhere else in the toolchain. Drifting from it would make the CLI a
  // third, subtly different dialect.
  const TRANSPILE_TARGET = "node22";
  const TS_FILE = /\.(ts|tsx|mts|cts)$/;
  const VERSION_QUERY = /\?v=\d+$/;

  // Read from cwd, not from core: `jsx`, `experimentalDecorators` and friends
  // are the *app's* call, and this is the same source of truth the dev
  // loader's resolve hook reads.
  const tsconfig = getTsconfig(process.cwd());
  const tsconfigRaw = JSON.stringify({
    compilerOptions: tsconfig?.config?.compilerOptions ?? {},
  });

  /**
   * Handover switch. Verified behaviour: in-thread hooks run *before*
   * `register()` worker hooks and delegate down the chain. So once the dev
   * server registers its own loader, these hooks would still intercept every
   * `.ts` first and short-circuit — silently bypassing the dev loader's
   * transpile cache and, worse, its `?v=N` HMR stamping.
   *
   * Setting `active = false` makes both hooks pure pass-throughs, handing the
   * TypeScript path over intact. `registerLoader()` should flip it just before
   * it calls `register()`; until it does, these hooks stay in charge, which is
   * the correct default for every non-dev command.
   */
  const bootstrapLoader = { active: true };
  globalThis.__warlockBootstrapLoader = bootstrapLoader;

  /**
   * `load` hook. In-thread (`registerHooks`) rather than the worker-thread
   * `register()`, which is what lets stage 2 below exist at all: a worker hook
   * could not hand a transpiled function back to this thread.
   */
  function load(url, context, nextLoad) {
    const cleanUrl = url.replace(VERSION_QUERY, "");

    // Not TypeScript → not ours. npm `.js`, `node:`, JSON all fall through.
    if (!bootstrapLoader.active || !TS_FILE.test(cleanUrl)) return nextLoad(url, context);

    const absolutePath = fileURLToPath(cleanUrl);
    const { code } = transformSync(readFileSync(absolutePath, "utf8"), {
      loader: absolutePath.endsWith(".tsx") ? "tsx" : "ts",
      format: "esm",
      target: TRANSPILE_TARGET,
      sourcefile: absolutePath,
      sourcemap: "inline",
      tsconfigRaw,
    });

    return { format: "module", source: code, shortCircuit: true };
  }

  registerHooks({ load });

  // Stage 2 — the reuse. With `load` live, core's own resolver can be pulled
  // in as TypeScript. It is imported by exact absolute path on purpose: it is
  // a leaf module whose only import is `node:url`, so it needs no extension
  // probing to load, which is precisely the thing we don't have yet.
  const { ownResolve } = await import(
    pathToFileURL(
      path.join(binDir, "..", "src", "dev-server", "loader", "own-resolver.ts"),
    ).href
  );

  let pathsMatcher = null;
  if (tsconfig) {
    pathsMatcher = specifier => resolvePathAlias(tsconfig, specifier);
  }

  /**
   * `resolve` hook — a thin sync wrapper over `ownResolve`, which owns
   * tsconfig `paths` plus TS extension/index probing. Everything it returns
   * `null` for (bare npm, `node:`, `file:`) falls through to Node's default,
   * which keeps `exports`/`node_modules` semantics intact.
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
    return owned ? { url: owned, shortCircuit: true } : nextResolve(specifier, context);
  }

  registerHooks({ resolve });

  // The transpile above emits inline maps; without this they'd be dead weight
  // and every CLI stack trace would point at generated line numbers.
  process.setSourceMapsEnabled(true);

  await import(pathToFileURL(sourceEntry).href);
}

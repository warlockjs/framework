import { putFileAsync } from "@warlock.js/fs";
import { build } from "esbuild";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type MessagePort, MessageChannel } from "node:worker_threads";
import type { TranspileInit } from "./load-hook.js";

/**
 * Bundle, write, and register the ESM loader hook.
 *
 * **Why bundle?**
 * `module.register()` runs the hook file in a fresh Node.js worker thread that
 * has no tsx hook of its own. The hook source is TypeScript, so we must produce
 * a plain ESM bundle before registering. esbuild inline-bundles all three hook
 * modules (`hook-thread`, `resolve-hook`, `load-hook`, `version-registry`)
 * into a single `.mjs` file written to `.warlock/`. External npm packages
 * (`esbuild`, `node:*`) are kept external â€” the hook thread can resolve those
 * from `node_modules` normally.
 *
 * **Why a file and not a `data:` URL?**
 * Some Node versions have issues resolving `import.meta.url` inside `data:`
 * modules. A real file under `.warlock/` is simpler and debuggable.
 *
 * **Timing**
 * Called from `FilesOrchestrator.init()` before any user `src/` module is
 * dynamically imported. `module.register()` takes effect for all subsequent
 * `import()` calls, which is exactly the window we need.
 *
 * @param transpile - Transpile-cache config to ship into the hook worker,
 *   or `null` to keep the hook in tsx-passthrough mode.
 *
 * @returns The main-thread side of the MessageChannel. Callers post
 *   `{ type: "bump", absolutePath }` messages on it to invalidate modules.
 *
 * @example
 * const port = await registerLoader(transpileInit);
 * // Later, when a file changes:
 * port.postMessage({ type: "bump", absolutePath: "/abs/path/to/user.model.ts" });
 */
export async function registerLoader(
  transpile: TranspileInit,
): Promise<MessagePort> {
  const { port1, port2 } = new MessageChannel();

  // hook-thread is a sibling module, so it shares THIS file's extension:
  // `.ts` when core runs from source (tsx), `.mjs` when published.
  const selfPath = fileURLToPath(import.meta.url);
  const hookThreadPath = path.join(
    path.dirname(selfPath),
    `hook-thread${path.extname(selfPath)}`,
  );

  const bundleResult = await build({
    entryPoints: [hookThreadPath],
    bundle: true,
    format: "esm",
    write: false,
    platform: "node",
    target: "node20",
    // Keep npm packages and Node built-ins external â€” the hook thread resolves
    // them normally from node_modules at runtime.
    packages: "external",
  });

  const bundledCode = bundleResult.outputFiles[0].text;
  // Caller (filesOrchestrator.init) guarantees .warlock/ exists before this runs.
  const hookBundlePath = path.join(process.cwd(), ".warlock", "loader-hook.mjs");
  await putFileAsync(hookBundlePath, bundledCode);

  const srcRoot = path.join(process.cwd(), "src");

  // No tsx registration: our hook owns resolution (own-resolver) and the
  // transpile of every `.ts`/`.tsx` (esbuild, in the load hook). The chain
  // is simply [our hook] → [Node default] for non-TS (npm/.js, node:).
  // In this monorepo tsx is still the *launcher* (`tsx start.ts`) so its
  // loader is present anyway, but it is never consulted for TypeScript —
  // our hook short-circuits first. A released `node bin/warlock.js` has no
  // tsx at all and relies entirely on this hook.

  register(pathToFileURL(hookBundlePath).href, import.meta.url, {
    data: { port: port2, srcRoot, transpile },
    transferList: [port2],
  });

  return port1;
}

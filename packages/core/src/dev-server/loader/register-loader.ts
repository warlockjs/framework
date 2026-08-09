import { putFileAsync } from "@warlock.js/fs";
import { build, type Plugin } from "esbuild";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type MessagePort, MessageChannel } from "node:worker_threads";
import type { TranspileInit } from "./load-hook.js";

/**
 * Rewrite the hook bundle's remaining npm imports to absolute paths resolved
 * from **core's own** location.
 *
 * The bundle is written into the consuming app's `.warlock/` directory, so a
 * bare `import "esbuild"` in it resolves starting from the *app*, walking up
 * the app's `node_modules`. `esbuild` and `get-tsconfig` are core's
 * dependencies, not the app's — under npm/yarn's flat hoisting they happen to
 * be reachable anyway, but under pnpm's strict layout they are not, and the
 * dev server dies with `ERR_MODULE_NOT_FOUND` for a package the app never
 * imported. That is a phantom dependency baked into generated code.
 *
 * Bundling them in instead is not an option for `esbuild`: its JS API is a
 * thin wrapper that spawns a platform-specific native binary, so inlining the
 * JavaScript would not remove the need for the package on disk. Resolving to
 * an absolute `file://` URL at generation time does — the generated file then
 * points straight at the copy core itself is using, whatever the installer's
 * layout.
 */
export const resolveExternalsFromCore: Plugin = {
  name: "warlock-resolve-externals-from-core",
  setup(build) {
    // The filter is deliberately loose — anything not starting `.` or `/` —
    // so the guards below carry the real logic.
    build.onResolve({ filter: /^[^./]/ }, args => {
      // The entry point comes through here too, and on Windows its absolute
      // path ("D:\\…") is not `.` or `/`. Marking it external fails the build.
      if (args.kind === "entry-point" || path.isAbsolute(args.path)) {
        return null;
      }

      if (args.path.startsWith("node:")) {
        return { external: true };
      }

      try {
        return { path: import.meta.resolve(args.path), external: true };
      } catch {
        // Unresolvable from here — leave it bare and let Node try, which is
        // exactly the previous behaviour rather than a hard failure.
        return { external: true };
      }
    });
  },
};

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
    // npm packages and Node built-ins stay external, but the plugin rewrites
    // each remaining npm specifier to an absolute path resolved from core's
    // own install — see `resolveExternalsFromCore` for why bare imports break
    // under pnpm's strict layout.
    packages: "external",
    plugins: [resolveExternalsFromCore],
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

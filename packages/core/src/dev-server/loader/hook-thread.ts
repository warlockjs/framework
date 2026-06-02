import type { MessagePort } from "node:worker_threads";
import { configureTranspile, load, type TranspileInit } from "./load-hook.js";
import { resolve, setSrcRoot } from "./resolve-hook.js";
import { bumpVersion } from "./version-registry.js";

type InitializeData = {
  port: MessagePort;
  srcRoot: string;
  /** Transpile config (always present — esbuild transpile is unconditional). */
  transpile: TranspileInit;
};

/**
 * ESM loader hook entry-point.
 *
 * Node's `module.register()` runs this file in a dedicated worker thread.
 * The three exported functions (`initialize`, `resolve`, `load`) are the
 * official hook lifecycle callbacks:
 *
 * - `initialize` — runs once when the hook worker starts; receives the data
 *   passed as `{ data }` to `module.register()`. We use it to configure the
 *   source-root filter and to wire the `MessageChannel` port that the main
 *   thread uses to push version-bump notifications.
 *
 * - `resolve` — intercepts every `import` specifier resolution. The
 *   framework's own resolver handles tsconfig `paths` + TS extension/index
 *   probing; npm/`node:` fall through to Node default. Stamps a `?v=<N>`
 *   version token onto tracked `src/` source-file URLs.
 *
 * - `load` — transpiles every `.ts`/`.tsx` with esbuild (content-hash
 *   cached); non-TypeScript falls through to the Node default loader.
 *
 * @example
 * // Main thread (register-loader.ts):
 * const { port1, port2 } = new MessageChannel();
 * module.register(hookBundleUrl, import.meta.url, {
 *   data: { port: port2, srcRoot: "/abs/path/to/src" },
 *   transferList: [port2],
 * });
 * // File watcher later:
 * port1.postMessage({ type: "bump", absolutePath: "/abs/path/to/user.model.ts" });
 */
export function initialize({ port, srcRoot, transpile }: InitializeData): void {
  setSrcRoot(srcRoot);
  configureTranspile(transpile);

  port.on("message", ({ type, absolutePath }: { type: string; absolutePath: string }) => {
    if (type === "bump") {
      bumpVersion(absolutePath);
    } else if (type === "sync") {
      port.postMessage({ type: "sync-ack" });
    }
  });
}

export { load, resolve };

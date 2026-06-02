import { register } from "node:module";
import { putFileAsync } from "@warlock.js/fs";
import path from "node:path";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MessageChannel } from "node:worker_threads";
//#region ../../@warlock.js/core/src/dev-server/loader/register-loader.ts
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
async function registerLoader(transpile) {
	const { port1, port2 } = new MessageChannel();
	const bundledCode = (await build({
		entryPoints: [path.join(path.dirname(fileURLToPath(import.meta.url)), "hook-thread.ts")],
		bundle: true,
		format: "esm",
		write: false,
		platform: "node",
		target: "node20",
		packages: "external"
	})).outputFiles[0].text;
	const hookBundlePath = path.join(process.cwd(), ".warlock", "loader-hook.mjs");
	await putFileAsync(hookBundlePath, bundledCode);
	const srcRoot = path.join(process.cwd(), "src");
	register(pathToFileURL(hookBundlePath).href, import.meta.url, {
		data: {
			port: port2,
			srcRoot,
			transpile
		},
		transferList: [port2]
	});
	return port1;
}
//#endregion
export { registerLoader };

//# sourceMappingURL=register-loader.mjs.map
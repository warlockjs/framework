import { linkNodeModules } from "../../__tests__/support/link-node-modules";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServer, type ViteDevServer } from "vite";
import { describe, expect, it } from "vitest";
import type * as SharedModule from "../shared";

type Runtime = typeof SharedModule;
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("shared runtime across watched server edits", () => {
  it("retains boot wiring and concurrent request isolation across repeated reloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "warlock-shared-hmr-"));
    let server: ViteDevServer | undefined;
    let initial: Runtime | undefined;
    let previous: SharedModule.SharedStoreResolver | undefined;
    const storage = new AsyncLocalStorage<SharedModule.SharedStore>();
    const source = await readFile(join(webRoot, "src/shared.ts"), "utf8");
    try {
      await writeFile(join(root, "shared.ts"), source);
      linkNodeModules(join(webRoot, "node_modules"), join(root, "node_modules"));
      server = await createServer({
        root,
        configFile: false,
        appType: "custom",
        logLevel: "silent",
        server: {
          middlewareMode: true,
          hmr: false,
          watch: { usePolling: true, interval: 20 },
          fs: { allow: [root, webRoot] },
        },
      });
      const vite = server;
      initial = (await vite.ssrLoadModule("/shared.ts")) as Runtime;
      await expect.poll(() => vite.watcher.getWatched()[root]?.includes("shared.ts")).toBe(true);
      previous = initial.connectSharedStore(() => storage.getStore());
      const retained = initial;
      for (let revision = 0; revision < 5; revision++) {
        if (revision > 0) {
          // Separate saves beyond the watcher coalescing window. The observed
          // event and exported revision below still prove each actual reload.
          await delay(150);
          const changed = new Promise<void>((done, reject) => {
            const timer = setTimeout(() => {
              vite.watcher.off("change", onChange);
              reject(new Error(`shared edit ${revision} was not observed`));
            }, 8000);
            function onChange(file: string) {
              if (file !== join(root, "shared.ts")) return;
              clearTimeout(timer);
              vite.watcher.off("change", onChange);
              done();
            }
            vite.watcher.on("change", onChange);
          });
          await writeFile(
            join(root, "shared.ts"),
            source + `\nexport const revision = ${revision};\n${"\n".repeat(revision)}`,
          );
          await changed;
        }
        if (revision > 0) {
          await expect
            .poll(async () => Reflect.get(await vite.ssrLoadModule("/shared.ts"), "revision"))
            .toBe(revision);
        }
        const reloaded = (await vite.ssrLoadModule("/shared.ts")) as Runtime;
        await Promise.all(
          ["light", "dark"].map(async (theme) => {
            const store = { response: { parse: async (value: unknown) => value } };
            retained.enterSharedScope(store);
            await storage.run(store, async () => {
              Reflect.set(retained.shared, "theme", theme);
              await Promise.resolve();
              expect(Reflect.get(reloaded.shared, "theme")).toBe(theme);
              await reloaded.sealShared();
              expect(Reflect.get(retained.shared, "theme")).toBe(theme);
            });
          }),
        );
        expect(() => Reflect.get(reloaded.shared, "theme")).toThrow("outside a request context");
      }
    } finally {
      initial?.connectSharedStore(previous);
      await server?.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});

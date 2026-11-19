import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appIdentity, bookRole, createWarlockAdapter, warlockHost } from "./adapter";
import { WARLOCK_LOGO_DATA_URI } from "./logo";

const folders: string[] = [];

function project(manifest: unknown): string {
  const root = mkdtempSync(path.join(tmpdir(), "grimoire-host-"));

  folders.push(root);
  mkdirSync(root, { recursive: true });

  if (manifest !== undefined)
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));

  return root;
}

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

describe("warlock adapter host", () => {
  it("reads the app's name and version from its package.json", () => {
    expect(appIdentity(project({ name: "shop", version: "1.4.0" }))).toEqual({
      name: "shop",
      version: "1.4.0",
    });
    expect(appIdentity(project({ name: "shop" }))).toEqual({ name: "shop", version: null });
  });

  it("reports no app when there is no readable package.json or no name", () => {
    expect(appIdentity(project(undefined))).toBeNull();
    expect(appIdentity(project({ version: "1.0.0" }))).toBeNull();
  });

  it("describes the framework with its logo, the installed version and the app", () => {
    const host = warlockHost(project({ name: "shop", version: "1.4.0" }), "5.59.0");

    expect(host).toEqual({
      name: "Warlock.js",
      version: "5.59.0",
      logo: WARLOCK_LOGO_DATA_URI,
      app: { name: "shop", version: "1.4.0" },
    });
    expect(WARLOCK_LOGO_DATA_URI.startsWith("data:image/png;base64,")).toBe(true);
    expect(warlockHost(project({}), "unknown").version).toBeNull();
  });

  it("supplies the host through the adapter", async () => {
    const adapter = createWarlockAdapter({ inspect: async () => ({}) as never });
    const host = await adapter.host?.(project({ name: "shop", version: "1.4.0" }));

    expect(host?.name).toBe("Warlock.js");
    expect(host?.app).toEqual({ name: "shop", version: "1.4.0" });
  });
});

describe("bookRole", () => {
  it("treats a file directly in <module>/commands/ and *.command.* files as commands, nothing else", () => {
    const role = (file: string) => bookRole({ file, role: "source" });

    expect(role("src/app/orders/commands/prune.ts")).toBe("command");
    expect(role("src/app/orders/services/prune.command.ts")).toBe("command");
    expect(role("src/app/orders/services/commands/helper.ts")).toBe("source");
    expect(role("src/app/orders/commands/shared/helper.ts")).toBe("source");
    expect(bookRole({ file: "src/app/orders/commands/x.ts", role: "controller" })).toBe(
      "controller",
    );
  });
});

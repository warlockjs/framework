import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { loadDevtoolsPanels } from "../src/panels";
import type { DevtoolsPanel } from "../src/types";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(packageRoot, "tests", "fixtures", "test-panel");

function panel(id: string, title = id): DevtoolsPanel {
  return { id, title, view: path.join(fixtures, "view.js") };
}

describe("loadDevtoolsPanels", () => {
  it("imports a ./ entry relative to the app root and calls its factory with the root", async () => {
    const warn = vi.fn();
    const [loaded] = await loadDevtoolsPanels(["./tests/fixtures/test-panel/panel.ts"], {
      root: packageRoot,
      warn,
    });

    expect(warn).not.toHaveBeenCalled();
    expect(loaded?.id).toBe("fixture");
    expect(loaded?.view.split(path.sep).join("/")).toMatch(
      /tests\/fixtures\/test-panel\/view\.js$/,
    );
    expect(Object.keys(loaded?.assets ?? {})).toEqual(["graph.js"]);
    expect(await loaded?.routes[0]?.handler({ params: {}, query: {}, body: undefined })).toEqual({
      root: packageRoot,
    });
  });

  it("reports a panels option that is not a list instead of loading it letter by letter", async () => {
    const warn = vi.fn();
    const importModule = vi.fn();
    const loaded = await loadDevtoolsPanels(
      "@warlock.js/grimoire/devtools" as unknown as readonly string[],
      { root: packageRoot, warn, importModule },
    );

    expect(loaded).toEqual([]);
    expect(importModule).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('The devtools "panels" option must be a list');
  });

  it("accepts a list of panels and a panel object", async () => {
    const loaded = await loadDevtoolsPanels(["list-module", panel("inline")], {
      root: packageRoot,
      warn: vi.fn(),
      importModule: async () => ({ default: async () => [panel("one"), panel("two")] }),
    });

    expect(loaded.map((item) => item.id)).toEqual(["one", "two", "inline"]);
  });

  it("imports a package entry it cannot resolve from the app root by its name", async () => {
    const importModule = vi.fn(async () => ({ default: panel("pkg") }));

    await loadDevtoolsPanels(["@example/not-installed/devtools"], {
      root: packageRoot,
      warn: vi.fn(),
      importModule,
    });

    expect(importModule).toHaveBeenCalledWith("@example/not-installed/devtools");
  });

  it("reports and skips a module that fails to load or has no default export", async () => {
    const warn = vi.fn();
    const loaded = await loadDevtoolsPanels(["broken", "empty", panel("kept")], {
      root: packageRoot,
      warn,
      importModule: async (specifier) => {
        if (specifier === "broken") throw new Error("Cannot find package 'broken'");
        return {};
      },
    });

    expect(loaded.map((item) => item.id)).toEqual(["kept"]);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      'Devtools panel module "broken" could not be loaded: Cannot find package \'broken\'. Check that it is installed and listed correctly in the devtools "panels" option.',
      'Devtools panel module "empty" could not be loaded: the module has no default export. Check that it is installed and listed correctly in the devtools "panels" option.',
    ]);
  });

  it("reports and skips a panel whose id is taken, keeping the first", async () => {
    const warn = vi.fn();
    const loaded = await loadDevtoolsPanels(
      [panel("processes"), panel("grimoire", "Grimoire"), panel("grimoire", "Copy")],
      { root: packageRoot, warn, taken: new Map([["processes", "Processes"]]) },
    );

    expect(loaded.map((item) => item.title)).toEqual(["Grimoire"]);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      'Devtools panel id "processes" is already registered by the "Processes" panel; each panel needs its own id. The panel was not added.',
      'Devtools panel id "grimoire" is already registered by the "Grimoire" panel; each panel needs its own id. The panel was not added.',
    ]);
  });

  it("resolves an import-only package from the app root", async () => {
    const app = mkdtempSync(path.join(tmpdir(), "devtools-panels-"));

    try {
      const pkg = path.join(app, "node_modules", "@example", "import-only");

      mkdirSync(path.join(pkg, "dist"), { recursive: true });
      writeFileSync(
        path.join(pkg, "package.json"),
        JSON.stringify({
          name: "@example/import-only",
          exports: { "./devtools": { types: "./dist/d.d.ts", import: "./dist/devtools.mjs" } },
        }),
      );
      writeFileSync(path.join(pkg, "dist", "devtools.mjs"), "export default {};");

      const importModule = vi.fn(async () => ({ default: panel("import-only") }));

      await loadDevtoolsPanels(["@example/import-only/devtools"], {
        root: app,
        warn: vi.fn(),
        importModule,
      });

      const called = String((importModule.mock.calls[0] as unknown[])[0]);

      expect(called.startsWith("file:")).toBe(true);
      expect(called.endsWith("/dist/devtools.mjs")).toBe(true);
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  it("passes the options of a [specifier, options] entry to the factory; root and mode always win", async () => {
    const factory = vi.fn(() => panel("optioned"));
    const importModule = vi.fn(async () => ({ default: factory }));

    const loaded = await loadDevtoolsPanels(
      [["@example/optioned/devtools", { ttlMs: 60_000, root: "/elsewhere", mode: "development" }]],
      { root: packageRoot, warn: vi.fn(), importModule, mode: "production" },
    );

    expect(loaded.map((item) => item.id)).toEqual(["optioned"]);
    expect(importModule).toHaveBeenCalledWith("@example/optioned/devtools");
    expect(factory).toHaveBeenCalledWith({ ttlMs: 60_000, root: packageRoot, mode: "production" });
  });

  it("reports and skips a tuple that is not [string, plain object], keeping the other entries", async () => {
    const warn = vi.fn();
    const importModule = vi.fn(async () => ({ default: panel("kept") }));
    const bad = [
      ["@example/a"],
      ["@example/a", "ttl"],
      ["@example/a", [1]],
      ["@example/a", null],
      [42, {}],
      ["@example/a", {}, {}],
    ] as unknown as readonly string[];

    const loaded = await loadDevtoolsPanels([...bad, ["@example/ok", {}] as never], {
      root: packageRoot,
      warn,
      importModule,
    });

    expect(loaded.map((item) => item.id)).toEqual(["kept"]);
    expect(importModule).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(6);
    expect(warn.mock.calls[0]?.[0]).toContain('["@example/a"]');
    expect(warn.mock.calls[0]?.[0]).toContain("use exactly [specifier, options]");
    expect(warn.mock.calls[1]?.[0]).toContain("second item is not a plain object");
    expect(warn.mock.calls[4]?.[0]).toContain("use the module specifier as a string");
  });

  it("names the specifier, not the pair, when a tuple's module fails to load", async () => {
    const warn = vi.fn();

    await loadDevtoolsPanels([["@example/missing", { a: 1 }]], {
      root: packageRoot,
      warn,
      importModule: async () => {
        throw new Error("Cannot find package");
      },
    });

    expect(warn.mock.calls[0]?.[0]).toContain(
      'Devtools panel module "@example/missing" could not be loaded',
    );
  });
});

describe("loadDevtoolsPanels errors", () => {
  it("hands the factory the error source, and the loader's own options and root win over a clash", async () => {
    const errors = vi.fn(async () => []);
    const seen: Record<string, unknown>[] = [];
    const factory = (context: Record<string, unknown>) => {
      seen.push(context);

      return panel("with-errors");
    };

    await loadDevtoolsPanels([["factory-module", { size: 3, errors: "mine" }]], {
      root: packageRoot,
      warn: vi.fn(),
      mode: "production",
      errors,
      importModule: async () => ({ default: factory }),
    });

    expect(seen[0]).toMatchObject({ size: 3, root: packageRoot, mode: "production", errors });
  });

  it("leaves errors out when none is given", async () => {
    const seen: Record<string, unknown>[] = [];

    await loadDevtoolsPanels(["factory-module"], {
      root: packageRoot,
      warn: vi.fn(),
      importModule: async () => ({
        default: (context: Record<string, unknown>) => {
          seen.push(context);

          return panel("no-errors");
        },
      }),
    });

    expect(Object.hasOwn(seen[0] ?? {}, "errors")).toBe(false);
  });
});

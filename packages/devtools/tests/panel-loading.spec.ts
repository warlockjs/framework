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
});

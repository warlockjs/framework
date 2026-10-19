import { describe, expect, it } from "vitest";
import { composePageModule, PageSetupModuleExportError } from "./compose-page-module";

describe("composePageModule", () => {
  it("retains the UI component and adds setup server exports", () => {
    const Page = () => null;
    const loader = () => ({ products: [] });
    const register = () => undefined;

    expect(
      composePageModule(
        { default: Page },
        { config: { route: "/products" }, loader, register },
        "src/web/products.page.tsx",
        "src/web/products.setup.ts",
      ),
    ).toEqual({ default: Page, config: { route: "/products" }, loader, register });
  });

  it("composes unnamed and named actions from setup", () => {
    const ui = { default: () => null };
    const setup = { action: () => ({ saved: true }) };
    const namedSetup = { actions: { save: setup.action } };

    expect(composePageModule(ui, setup, "contact.page.tsx", "contact.setup.ts")).toEqual({
      ...ui,
      ...setup,
    });
    expect(composePageModule(ui, namedSetup, "cart.page.tsx", "cart.setup.ts")).toEqual({
      ...ui,
      ...namedSetup,
    });
  });

  it("returns the original UI namespace when no setup exists", () => {
    const module = { default: () => null };

    expect(composePageModule(module, undefined, "src/web/index.page.tsx")).toBe(module);
  });

  it("rejects a duplicate export and names both files", () => {
    expect(() =>
      composePageModule(
        { config: { route: "/ui" } },
        { config: { route: "/setup" } },
        "src/web/index.page.tsx",
        "src/web/index.setup.ts",
      ),
    ).toThrow(PageSetupModuleExportError);
    expect(() =>
      composePageModule(
        { config: { route: "/ui" } },
        { config: { route: "/setup" } },
        "src/web/index.page.tsx",
        "src/web/index.setup.ts",
      ),
    ).toThrow('both files export "config"');
  });

  it.each(["default", "ErrorBoundary", "metadata"])("refuses the %s export from setup", (name) => {
    expect(() =>
      composePageModule(
        { default: () => null },
        { [name]: () => null },
        "src/web/index.page.tsx",
        "src/web/index.setup.ts",
      ),
    ).toThrow(
      `Cannot compose "src/web/index.page.tsx" with "src/web/index.setup.ts": setup files may export only config, loader, register, action, actions; found "${name}".`,
    );
  });

  it.each(["config", "loader", "register", "action", "actions"])(
    "rejects duplicate %s declarations",
    (name) => {
      expect(() =>
        composePageModule({ [name]: {} }, { [name]: {} }, "a.page.tsx", "a.setup.ts"),
      ).toThrow(`both files export "${name}"`);
    },
  );

  it("returns the same namespace for the same ui/setup pair so register() runs once", () => {
    const ui = { default: () => null };
    const setup = { register: () => undefined };

    expect(composePageModule(ui, setup, "a.tsx", "a.setup.ts")).toBe(
      composePageModule(ui, setup, "a.tsx", "a.setup.ts"),
    );
  });
});

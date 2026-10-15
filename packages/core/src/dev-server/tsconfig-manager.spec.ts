import { describe, expect, it } from "vitest";
import { TSConfigManager } from "./tsconfig-manager";

function managerWith(paths: Record<string, string[]>) {
  const manager = new TSConfigManager();
  manager.tsconfig = { compilerOptions: { paths } };
  manager.aliases = paths;
  return manager;
}

describe("TSConfigManager.isAlias", () => {
  const manager = managerWith({
    "@/*": ["./src/*"],
    "@app/*": ["./src/app/*"],
    "app/*": ["./src/app/*"],
    "@warlock.js/core": ["@warlock.js/core"],
  });

  it("treats @-prefixed mapped patterns as aliases", () => {
    expect(manager.isAlias("@/foo")).toBe(true);
    expect(manager.isAlias("@app/x")).toBe(true);
  });

  it("does not treat an unmapped @-package as an alias", () => {
    expect(manager.isAlias("@warlock.js/core")).toBe(false);
    expect(manager.isAlias("@warlock.js/cache")).toBe(false);
  });

  it("does not match a longer sibling name by prefix", () => {
    expect(manager.isAlias("application/x")).toBe(false);
  });

  it("keeps plain aliases working", () => {
    expect(manager.isAlias("app/users/service")).toBe(true);
  });
});

describe("TSConfigManager.init follows `extends` (C2:B3)", () => {
  it("reads paths and decorator flags from the base config", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const nodePath = await import("node:path");
    const root = mkdtempSync(nodePath.join(tmpdir(), "warlock-tsconfig-"));
    const cwd = process.cwd();

    writeFileSync(
      nodePath.join(root, "tsconfig.base.json"),
      JSON.stringify({
        compilerOptions: { experimentalDecorators: true, baseUrl: ".", paths: { "app/*": ["./src/app/*"] } },
      }),
    );
    writeFileSync(nodePath.join(root, "tsconfig.json"), JSON.stringify({ extends: "./tsconfig.base.json" }));

    try {
      process.chdir(root);
      const manager = new TSConfigManager();
      manager.init();

      expect(manager.isAlias("app/users/x")).toBe(true);
      expect(manager.tsconfig.compilerOptions.experimentalDecorators).toBe(true);
    } finally {
      process.chdir(cwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

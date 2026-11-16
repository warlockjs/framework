import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();

vi.mock("@warlock.js/fs", () => ({
  fileExistsAsync: vi.fn(async (path: string) => files.has(path.replace(/^.*[\\/]/, ""))),
  getFileAsync: vi.fn(async (path: string) => files.get(path.replace(/^.*[\\/]/, "")) ?? ""),
  putFileAsync: vi.fn(async (path: string, content: string) => {
    files.set(path.replace(/^.*[\\/]/, ""), content);
  }),
}));

import { featuresMap } from "./index";
import { grimoireFeature } from "./grimoire.feature";

const TEMPLATE_CONFIG = `import {
  authMigrations,
  registerAuthCleanupCommand,
  registerJWTSecretGeneratorCommand,
} from "@warlock.js/auth";
import { defineConfig } from "@warlock.js/core";

export default defineConfig({
  cli: {
    commands: [registerJWTSecretGeneratorCommand(), registerAuthCleanupCommand()],
  },
  database: {
    migrations: authMigrations,
  },
});
`;

describe("add grimoire", () => {
  beforeEach(() => {
    files.clear();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is listed and depends on the grimoire package at the installed version", () => {
    expect(featuresMap.grimoire).toBe(grimoireFeature);
    expect(grimoireFeature.dependencies).toHaveProperty("@warlock.js/grimoire");
  });

  it("registers the commands in a config that already has a cli block", async () => {
    files.set("warlock.config.ts", TEMPLATE_CONFIG);

    await grimoireFeature.onExecuting?.({} as never);

    const config = files.get("warlock.config.ts") ?? "";

    expect(
      config.startsWith(
        'import { registerGrimoireCommands } from "@warlock.js/grimoire/warlock";\n',
      ),
    ).toBe(true);
    expect(config).toContain("registerGrimoireCommands(), registerJWTSecretGeneratorCommand()");
  });

  it("adds a cli block to a config without one", async () => {
    files.set(
      "warlock.config.ts",
      'import { defineConfig } from "@warlock.js/core";\n\nexport default defineConfig({\n  build: {},\n});\n',
    );

    await grimoireFeature.onExecuting?.({} as never);

    expect(files.get("warlock.config.ts")).toContain(
      "export default defineConfig({\n  cli: { commands: [registerGrimoireCommands()] },\n  build: {},",
    );
  });

  it("changes nothing on a second run", async () => {
    files.set("warlock.config.ts", TEMPLATE_CONFIG);
    files.set(".gitignore", "node_modules\n");
    await grimoireFeature.onExecuting?.({} as never);
    const after = new Map(files);

    await grimoireFeature.onExecuting?.({} as never);

    expect(files).toEqual(after);
  });

  it("ignores the generated files, mounts the devtools panel and adds the reporter", async () => {
    files.set("warlock.config.ts", TEMPLATE_CONFIG);
    files.set(".gitignore", "node_modules\n");
    files.set(
      "vite.config.ts",
      'export default defineConfig({ test: { reporters: ["default"] } });\n',
    );

    await grimoireFeature.onExecuting?.({} as never);

    expect(files.get(".gitignore")).toContain("/grimoire/book/");
    expect(files.get("devtools.ts")).toContain('"@warlock.js/grimoire/devtools"');
    expect(files.get("vite.config.ts")).toContain('reporters: ["default", grimoireReporter()]');
    expect(files.get("vite.config.ts")).toContain('from "@warlock.js/grimoire/vitest"');
  });

  it("creates no vite config when the app does not run Vitest", async () => {
    files.set("warlock.config.ts", TEMPLATE_CONFIG);

    await grimoireFeature.onExecuting?.({} as never);

    expect(files.has("vite.config.ts")).toBe(false);
  });
});

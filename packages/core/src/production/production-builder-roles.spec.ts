import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { ProductionBuilder } from "./production-builder";

// The build removes its working dir once bundling ends, so the generated
// entry is snapshotted at the moment esbuild is handed it.
let generatedEntry = "";

vi.mock("esbuild", () => ({
  default: {
    build: vi.fn(async (options: { entryPoints: string[] }) => {
      const dir = path.dirname(options.entryPoints[0]!);
      generatedEntry = await fs.readFile(path.join(dir, "app.ts"), "utf8");
    }),
    transformSync: () => ({ code: "" }),
  },
}));

vi.mock("../dev-server/tsconfig-manager", () => ({
  tsconfigManager: { init: vi.fn(), baseUrl: ".", aliases: {} },
}));

vi.mock("../connectors/connectors-manager", () => ({
  connectorsManager: { isBuiltInName: () => false },
}));

vi.mock("../warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: {
    get: vi.fn((key: string) => {
      if (key === "connectors") return [];
      if (key === "build") return mockBuildConfig;
      return undefined;
    }),
  },
}));

let mockBuildConfig: Record<string, unknown> = {};

async function writeFixtureApp(tempRoot: string, withWorker: boolean): Promise<void> {
  await fs.mkdir(path.join(tempRoot, "src/app/jobs"), { recursive: true });
  await fs.mkdir(path.join(tempRoot, "src/config"), { recursive: true });
  await fs.writeFile(path.join(tempRoot, "src/config/app.ts"), "export default {};\n");
  await fs.writeFile(path.join(tempRoot, "src/app/jobs/routes.ts"), "export {};\n");
  await fs.writeFile(path.join(tempRoot, "src/app/main.ts"), "export {};\n");
  if (withWorker) {
    await fs.writeFile(path.join(tempRoot, "src/app/jobs/worker.ts"), "export {};\n");
  }
  await fs.writeFile(
    path.join(tempRoot, "package.json"),
    JSON.stringify({ name: "fixture-app", dependencies: { "@warlock.js/core": "*" } }),
  );

  mockBuildConfig = {
    outdir: path.join(tempRoot, "dist"),
    outFile: "app.js",
    singleBundle: true,
    esmShim: false,
  };
}

describe("ProductionBuilder role-conditional imports", () => {
  let tempRoot: string;
  let previousCwd: string;

  beforeEach(async () => {
    previousCwd = process.cwd();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "warlock-roles-"));
    process.chdir(tempRoot);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("guards routes/workers/preflight by role and still imports main unconditionally", async () => {
    await writeFixtureApp(tempRoot, true);

    await new ProductionBuilder().build();

    expect(generatedEntry).toContain('if (Application.hasRole("api")) {');
    expect(generatedEntry).toContain('await import("./routes");');
    expect(generatedEntry).toContain('if (Application.hasRole("worker")) {');
    expect(generatedEntry).toContain('await import("./workers");');
    expect(generatedEntry).toContain(
      'if (Application.hasRole("api") || Application.hasRole("web")) {',
    );
    expect(generatedEntry).toContain("await preflightConfiguredHttpPort();");

    // `main` stays unconditional, unlike routes/workers.
    const mainImportLine = generatedEntry
      .split("\n")
      .find((line) => line.includes('await import("./main")'));
    expect(mainImportLine?.trim()).toBe('await import("./main");');
  }, 60_000);

  it("skips the ./workers import entirely when the app has no worker.ts", async () => {
    await writeFixtureApp(tempRoot, false);

    await new ProductionBuilder().build();

    expect(generatedEntry).not.toContain("./workers");
    expect(generatedEntry).not.toContain('Application.hasRole("worker")');
  }, 60_000);
});

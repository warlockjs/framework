import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionBuilder } from "./production-builder";

// The build removes its working dir once bundling ends, so the generated
// sources are snapshotted at the moment esbuild is handed the entry.
const generated: Record<string, string> = {};

vi.mock("esbuild", () => ({
  default: {
    build: vi.fn(async (options: { entryPoints: string[] }) => {
      const dir = path.dirname(options.entryPoints[0]!);

      for (const file of ["app.ts", "bootstrap.ts", "config-loader.ts"]) {
        generated[file] = await fs.readFile(path.join(dir, file), "utf8");
      }
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

describe("ProductionBuilder generated entry order", () => {
  let tempRoot: string;
  let previousCwd: string;

  beforeEach(async () => {
    previousCwd = process.cwd();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "warlock-entry-order-"));
    process.chdir(tempRoot);

    await fs.mkdir(path.join(tempRoot, "src/app"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "src/config"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "src/app/bootstrap.ts"), "export {};\n");
    await fs.writeFile(path.join(tempRoot, "src/app/prestart.ts"), "export {};\n");
    await fs.writeFile(path.join(tempRoot, "src/config/app.ts"), "export default {};\n");
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
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("puts the app bootstrap and prestart imports before config and everything else", async () => {
    await new ProductionBuilder().build();

    const firstImport = (source: string) =>
      source.split("\n").find(line => line.trimStart().startsWith("import "));

    // The entry's very first import is ./bootstrap, ahead of config and connectors...
    const entry = generated["app.ts"]!;
    expect(firstImport(entry)).toBe('import "./bootstrap";');
    expect(entry.indexOf('import "./bootstrap"')).toBeLessThan(entry.indexOf("./config-loader"));

    // ...and that file's first import is the app's own bootstrap, ahead of core.
    const bootstrap = generated["bootstrap.ts"]!;
    expect(firstImport(bootstrap)).toBe("import './../../src/app/bootstrap';");

    // The config loader starts with the app's prestart, ahead of every config import.
    const configLoader = generated["config-loader.ts"]!;
    expect(firstImport(configLoader)).toBe("import './../../src/app/prestart';");
  }, 60_000);
});

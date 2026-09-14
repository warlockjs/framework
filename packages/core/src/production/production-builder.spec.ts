import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorLifecyclePhase, type Connector } from "../connectors/types";

/**
 * Records the exact esbuild call arguments so the delete-vs-copy fix can be
 * asserted on the bundling side too. `bundle()` is still mocked out here —
 * this spec is about what {@link ConnectorBuildContext.options} looks like
 * to `emit` hooks, not about exercising esbuild itself.
 */
const esbuildBuildMock = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock("esbuild", () => ({
  default: { build: (...args: unknown[]) => esbuildBuildMock(...args) },
}));

// `tsconfigManager.init()` reads a real tsconfig.json off disk; the fixture
// app has none, so the manager is stubbed to a no-op with an empty alias map.
vi.mock("../dev-server/tsconfig-manager", () => ({
  tsconfigManager: {
    init: vi.fn(),
    baseUrl: ".",
    aliases: {},
  },
}));

// `assertNoReservedConnectorNames` pulls in the real `connectorsManager`
// singleton, whose built-in connector registry statically imports the whole
// HTTP/container stack. None of that is needed to prove the options-object
// bug, so it is stubbed to the one method the assertion calls.
vi.mock("../connectors/connectors-manager", () => ({
  connectorsManager: {
    isBuiltInName: () => false,
  },
}));

let mockConnectors: Connector[] = [];
let mockBuildConfig: Record<string, unknown> = {};

vi.mock("../warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: {
    get: vi.fn((key: string) => {
      if (key === "connectors") return mockConnectors;
      if (key === "build") return mockBuildConfig;
      return undefined;
    }),
  },
}));

/**
 * A minimal, valid `Connector` whose only real behavior is the `build`
 * contribution passed in — the runtime lifecycle methods are never called by
 * `warlock build`, which only drains `build.generate` / `build.emit`.
 */
function fixtureConnector(
  name: string,
  build: Connector["build"],
): Connector {
  return {
    name,
    priority: 1,
    lifecyclePhase: ConnectorLifecyclePhase.Early,
    isActive: () => false,
    boot: () => undefined,
    start: async () => undefined,
    restart: async () => undefined,
    shutdown: async () => undefined,
    shouldRestart: () => false,
    build,
  };
}

describe("ProductionBuilder", () => {
  let tempRoot: string;
  let previousCwd: string;

  beforeEach(async () => {
    previousCwd = process.cwd();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "warlock-production-builder-"));
    process.chdir(tempRoot);

    await fs.mkdir(path.join(tempRoot, "src/app"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "src/config"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify({
        name: "fixture-app",
        dependencies: { "@warlock.js/core": "*" },
      }),
    );

    mockConnectors = [];
    mockBuildConfig = {
      outdir: path.join(tempRoot, "dist"),
      outFile: "app.js",
      singleBundle: true,
      esmShim: false,
      banner: { js: "/* fixture banner */" },
    };

    esbuildBuildMock.mockClear();
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it("hands the emit contribution the same outFile/entryPath/singleBundle/esmShim/banner the build was configured with", async () => {
    const seen: {
      outFile?: string;
      entryPath?: string;
      singleBundle?: boolean;
      esmShim?: boolean;
      banner?: Record<string, string>;
    } = {};

    mockConnectors = [
      fixtureConnector("fixture-emit-recorder", {
        emit(context) {
          seen.outFile = context.options.outFile;
          seen.entryPath = context.options.entryPath;
          seen.singleBundle = context.options.singleBundle;
          seen.esmShim = context.options.esmShim;
          seen.banner = context.options.banner;
        },
      }),
    ];

    const { ProductionBuilder } = await import("./production-builder");
    const builder = new ProductionBuilder();

    await builder.build();

    expect(seen.outFile).toBe("app.js");
    expect(seen.entryPath).toBe(path.resolve(tempRoot, "dist", "app.js"));
    expect(seen.singleBundle).toBe(true);
    expect(seen.esmShim).toBe(false);
    expect(seen.banner).toEqual({ js: "/* fixture banner */" });
  });
});

import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeBuildConfig } from "../../../src/warlock-config/normalize-build-config";

const getConfig = vi.fn();

vi.mock("../../../src/warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: { get: (key: string) => getConfig(key) },
}));

const { resolveBuildConfig } = await import("../../../src/production/resolve-build-config");

describe("normalizeBuildConfig", () => {
  it("folds outDirectory into outdir", () => {
    expect(normalizeBuildConfig({ outDirectory: "build" }).outdir).toBe("build");
  });

  it("lets an explicit outdir win", () => {
    expect(normalizeBuildConfig({ outdir: "wins", outDirectory: "loses" }).outdir).toBe("wins");
  });

  it("returns the very same object when there is nothing to fold", () => {
    const build = { outdir: "dist" };

    expect(normalizeBuildConfig(build)).toBe(build);
  });
});

describe("resolveBuildConfig", () => {
  beforeEach(() => vi.clearAllMocks());

  it("honours outDirectory from a config that never went through defineConfig", () => {
    // A project may `export default { ... }` instead of calling defineConfig,
    // so the alias has to be folded at read time too.
    getConfig.mockReturnValue({ outDirectory: "artifacts" });

    const resolved = resolveBuildConfig();

    expect(resolved.outdir).toBe("artifacts");
    expect(resolved.entryPath).toBe(path.resolve("artifacts", "app.js"));
  });

  it("honours outdir directly", () => {
    getConfig.mockReturnValue({ outdir: "artifacts" });

    expect(resolveBuildConfig().outdir).toBe("artifacts");
  });

  it("falls back to the default output directory", () => {
    getConfig.mockReturnValue(undefined);

    const resolved = resolveBuildConfig();

    expect(resolved.outdir).toBe(process.cwd() + "/dist");
    expect(resolved.outFile).toBe("app.js");
  });

  it("points entryPath at outdir/outFile", () => {
    getConfig.mockReturnValue({ outdir: "out", outFile: "server.js" });

    expect(resolveBuildConfig().entryPath).toBe(path.resolve("out", "server.js"));
  });
});

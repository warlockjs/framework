import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeBuildConfig } from "../../../src/warlock-config/normalize-build-config";
import type { WarlockConfig } from "../../../src/warlock-config/types";

const getConfig = vi.fn();

vi.mock("../../../src/warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: { get: (key: string) => getConfig(key) },
}));

const { resolveBuildConfig, ForbiddenBuildOptionError } = await import(
  "../../../src/production/resolve-build-config"
);

/**
 * Compile-time half of the tsconfig guard. The `@ts-expect-error` directives
 * are the negative controls: esbuild's `tsconfig`/`tsconfigRaw` force the
 * app's compiler options onto every workspace package in the bundle, so they
 * must not be reachable from a typed config. If either ever compiles again,
 * the directive turns into a TS2578 "unused directive" error.
 */

// @ts-expect-error — esbuild's `tsconfig` must NOT be settable in warlock build config
const buildWithTsconfig: WarlockConfig["build"] = { tsconfig: "./tsconfig.json" };

const buildWithTsconfigRaw: WarlockConfig["build"] = {
  // @ts-expect-error — esbuild's `tsconfigRaw` must NOT be settable in warlock build config
  tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
};

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

  it("keeps the compile-time tsconfig rejections referenced", () => {
    expect(buildWithTsconfig).toBeTypeOf("object");
    expect(buildWithTsconfigRaw).toBeTypeOf("object");
  });

  // The type guard above is erased at runtime, so an `as any` config — or a
  // plain JS warlock.config.js — can still carry the key through. Rejected,
  // never stripped: silently dropping it would hide a real intent mismatch.
  it.each(["tsconfig", "tsconfigRaw"] as const)("rejects an esbuild %s", key => {
    getConfig.mockReturnValue({ [key]: "./tsconfig.json" });

    expect(() => resolveBuildConfig()).toThrow(ForbiddenBuildOptionError);
    expect(() => resolveBuildConfig()).toThrow(key);
  });
});

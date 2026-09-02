import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connector, ConnectorBuildContext } from "../../../src/connectors/types";

/**
 * `ProductionBuilder.build()`'s own orchestration of the temp-and-promote
 * mechanism (422a43c7 / 560cc1d1), plus the split those cards got wrong:
 *
 * - esbuild writes into a TEMP directory beside `outdir`, never `outdir`;
 * - `options.outdir` stays the FINAL destination for every consumer, because
 *   consumers bake it into runtime output (`web`'s `clientDir`) and a temp
 *   path there produces an artifact pointing at a directory promotion has
 *   renamed away;
 * - a build that fails leaves no `dist` that `warlock start` will boot.
 *
 * The promotion primitives themselves are covered in `dist-promotion.test.ts`
 * and `promote-dist.rollback.test.ts` — these assert the builder wires them
 * in correctly, in the right order.
 */

const putFileAsync = vi.hoisted(() => vi.fn(async () => undefined));
const putJsonFileAsync = vi.hoisted(() =>
  vi.fn(async (_filePath: string, _content: unknown) => undefined),
);
const renameFileAsync = vi.hoisted(() => vi.fn(async (_from: string, _to: string) => undefined));
const removeDirectoryAsync = vi.hoisted(() => vi.fn(async (_directory: string) => undefined));
const directoryExistsAsync = vi.hoisted(() => vi.fn(async () => false));

/** Toggled per test to force `esbuild.build` to fail like a real compile error. */
const esbuildShouldFail = vi.hoisted(() => ({ value: false }));

/** The connectors `initializeOptions` reads out of warlock.config.ts. */
const configuredConnectors = vi.hoisted(() => ({ value: [] as Connector[] }));

const esbuildBuild = vi.hoisted(() =>
  vi.fn(async (_options: Record<string, unknown>) => {
    if (esbuildShouldFail.value) {
      throw new Error("simulated esbuild compile failure");
    }

    return {};
  }),
);

vi.mock("@warlock.js/fs", () => ({
  ensureDirectoryAsync: vi.fn(async () => undefined),
  fileExistsAsync: vi.fn(async () => false),
  directoryExistsAsync,
  getFileAsync: vi.fn(async () => ""),
  getJsonFileAsync: vi.fn(async () => ({ dependencies: {} })),
  putFileAsync,
  putJsonFileAsync,
  renameFileAsync,
  removeDirectoryAsync,
}));

vi.mock("esbuild", () => ({ default: { build: esbuildBuild } }));

vi.mock("fast-glob", () => ({ default: vi.fn(async () => []) }));

vi.mock("../../../src/dev-server/tsconfig-manager", () => ({
  tsconfigManager: { init: vi.fn(), aliases: {}, baseUrl: "." },
}));

vi.mock("../../../src/warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: {
    isLoaded: true,
    get: vi.fn(() => configuredConnectors.value),
  },
}));

const FINAL_OUT_DIR = vi.hoisted(() => "/app/dist");

vi.mock("../../../src/production/resolve-build-config", () => ({
  resolveBuildConfig: vi.fn(() => ({
    outdir: FINAL_OUT_DIR,
    outFile: "app.js",
    minify: false,
    sourcemap: false,
  })),
}));

const { ProductionBuilder } = await import("../../../src/production/production-builder");
const { DIST_BUILD_MANIFEST_FILE_NAME } = await import(
  "../../../src/production/dist-build-manifest"
);

/**
 * A connector carrying only the two build hooks — enough for the drain, and
 * nothing the lifecycle would touch (`build` never boots connectors).
 */
function buildConnector(name: string, build: NonNullable<Connector["build"]>): Connector {
  return { name, build } as unknown as Connector;
}

describe("ProductionBuilder.build() — temp write target, final outdir", () => {
  beforeEach(() => {
    esbuildShouldFail.value = false;
    configuredConnectors.value = [];
    esbuildBuild.mockClear();
    putFileAsync.mockClear();
    putJsonFileAsync.mockClear();
    renameFileAsync.mockClear();
    removeDirectoryAsync.mockClear();
    directoryExistsAsync.mockReset();
    directoryExistsAsync.mockResolvedValue(false);
  });

  it("bundles into a temp directory beside outdir, never outdir itself", async () => {
    await new ProductionBuilder().build();

    const esbuildOptions = esbuildBuild.mock.calls[0]![0] as Record<string, unknown>;

    expect(esbuildOptions.outdir).not.toBe(FINAL_OUT_DIR);
    expect(String(esbuildOptions.outdir)).toContain(".dist.build-");
  });

  /**
   * THE regression. `options.outdir` used to be mutated to the temp path for
   * the duration of the build, so `web`'s contribution recorded
   * `<temp>/client` as the `clientDir` its runtime serves browser assets
   * from — a directory that stops existing the moment promotion renames the
   * temp dir onto `dist`.
   */
  it("hands contribution hooks the FINAL outdir, never the temp write target", async () => {
    const seen: Array<{ hook: string; outdir: string }> = [];

    const record = (hook: string) => {
      return async (context: ConnectorBuildContext) => {
        seen.push({ hook, outdir: context.options.outdir });
      };
    };

    configuredConnectors.value = [
      buildConnector("web", {
        generate: record("generate"),
        emit: record("emit"),
      }),
    ];

    await new ProductionBuilder().build();

    expect(seen.map((entry) => entry.hook)).toEqual(["generate", "emit"]);

    for (const entry of seen) {
      expect(entry.outdir).toBe(FINAL_OUT_DIR);
      expect(entry.outdir).not.toContain(".dist.build-");
    }
  });

  it("leaves options.outdir untouched after the build, for whatever reads the config next", async () => {
    const builder = new ProductionBuilder();

    await builder.build();

    const options = (builder as unknown as { options: { outdir: string } }).options;

    expect(options.outdir).toBe(FINAL_OUT_DIR);
  });

  it("runs emit AFTER the bundle is promoted, so what emit writes into outdir survives", async () => {
    let emitCallOrder = 0;

    configuredConnectors.value = [
      buildConnector("web", {
        emit: async () => {
          emitCallOrder = renameFileAsync.mock.invocationCallOrder.length;
        },
      }),
    ];

    await new ProductionBuilder().build();

    // At least one rename (temp -> dist) had already happened when emit ran.
    expect(emitCallOrder).toBeGreaterThan(0);
    expect(renameFileAsync.mock.calls[0]![1]).toBe(FINAL_OUT_DIR);
  });

  it("writes the build-success marker into outdir, and only after everything else", async () => {
    await new ProductionBuilder().build();

    expect(putJsonFileAsync).toHaveBeenCalledTimes(1);
    expect(renameFileAsync).toHaveBeenCalledTimes(1);

    const [markerPath] = putJsonFileAsync.mock.calls[0]!;
    const [renameFrom, renameTo] = renameFileAsync.mock.calls[0]!;

    expect(String(renameFrom)).toContain(".dist.build-");
    expect(renameTo).toBe(FINAL_OUT_DIR);

    // The marker lands in the REAL dist, after the promotion — it is the one
    // thing `warlock start` trusts, so nothing may precede it.
    expect(markerPath).toBe(path.join(FINAL_OUT_DIR, DIST_BUILD_MANIFEST_FILE_NAME));
    expect(putJsonFileAsync.mock.invocationCallOrder[0]!).toBeGreaterThan(
      renameFileAsync.mock.invocationCallOrder[0]!,
    );
  });

  it("replaces an existing dist wholesale (move-aside, promote, delete-old) rather than writing into it", async () => {
    directoryExistsAsync.mockResolvedValue(true);

    await new ProductionBuilder().build();

    // 1: dist -> stale, 2: temp -> dist
    expect(renameFileAsync).toHaveBeenCalledTimes(2);
    expect(renameFileAsync.mock.calls[0]![0]).toBe(FINAL_OUT_DIR);
    expect(renameFileAsync.mock.calls[1]![1]).toBe(FINAL_OUT_DIR);

    // The stale copy is deleted only once the new dist is complete — after
    // the build-success marker, not before it.
    const staleDir = renameFileAsync.mock.calls[0]![1];
    const staleRemovalIndex = removeDirectoryAsync.mock.calls.findIndex(
      ([directory]) => directory === staleDir,
    );

    expect(staleRemovalIndex).toBeGreaterThanOrEqual(0);
    expect(removeDirectoryAsync.mock.invocationCallOrder[staleRemovalIndex]!).toBeGreaterThan(
      putJsonFileAsync.mock.invocationCallOrder[0]!,
    );
  });

  it("a failed bundle never touches outdir and cleans up only its own temp directory", async () => {
    esbuildShouldFail.value = true;

    await expect(new ProductionBuilder().build()).rejects.toThrow(
      "simulated esbuild compile failure",
    );

    // Promotion never runs, and the build-success marker never gets written.
    expect(renameFileAsync).not.toHaveBeenCalled();
    expect(putJsonFileAsync).not.toHaveBeenCalled();

    // Only the temp directory is discarded — never `outdir` itself.
    expect(removeDirectoryAsync).toHaveBeenCalledTimes(1);
    const [cleanedUpPath] = removeDirectoryAsync.mock.calls[0]!;
    expect(cleanedUpPath).not.toBe(FINAL_OUT_DIR);
    expect(String(cleanedUpPath)).toContain(".dist.build-");
  });

  it("rolls the promotion back and writes no marker when an emit contribution fails", async () => {
    directoryExistsAsync.mockResolvedValue(true);

    configuredConnectors.value = [
      buildConnector("web", {
        emit: async () => {
          throw new Error("simulated client bundle failure");
        },
      }),
    ];

    await expect(new ProductionBuilder().build()).rejects.toThrow(
      "simulated client bundle failure",
    );

    // No build-success marker — `warlock start` refuses whatever is in dist.
    expect(putJsonFileAsync).not.toHaveBeenCalled();

    const staleDir = renameFileAsync.mock.calls[0]![1];

    // 1: dist -> stale, 2: temp -> dist, 3: dist -> failed, 4: stale -> dist
    expect(renameFileAsync).toHaveBeenCalledTimes(4);
    expect(renameFileAsync.mock.calls[3]).toEqual([staleDir, FINAL_OUT_DIR]);

    // The previous build is restored, not deleted.
    expect(removeDirectoryAsync).not.toHaveBeenCalledWith(staleDir);
  });

  it("leaves no dist at all when an emit contribution fails and there was no previous build", async () => {
    configuredConnectors.value = [
      buildConnector("web", {
        emit: async () => {
          throw new Error("simulated client bundle failure");
        },
      }),
    ];

    await expect(new ProductionBuilder().build()).rejects.toThrow(
      "simulated client bundle failure",
    );

    expect(putJsonFileAsync).not.toHaveBeenCalled();
    expect(removeDirectoryAsync).toHaveBeenCalledWith(FINAL_OUT_DIR);
  });
});

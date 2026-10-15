import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileManager } from "../../../src/dev-server/file-manager";
import type { SpecialFilesCollector } from "../../../src/dev-server/special-files-collector";

/**
 * S13 — a route module that throws on load/register must surface the error
 * (not silently 404). These tests drive the real `import()` path of
 * ModuleLoader against on-disk `.mjs` fixtures: one that throws at module
 * evaluation, one that loads cleanly. The router and dev logger are mocked so
 * the assertions focus on whether the failure propagates.
 */
const routerMock = vi.hoisted(() => ({
  removeRoutesBySourceFile: vi.fn(),
  // withSourceFile must run the callback so a throwing route file's error
  // propagates exactly as the real router does (it rethrows after logging).
  withSourceFile: vi.fn(
    async (_sourceFile: string, callback: () => unknown) => await callback(),
  ),
}));

vi.mock("../../../src/router/router", () => ({ router: routerMock }));
vi.mock("../../../src/dev-server/dev-logger", () => ({
  devLogError: vi.fn(),
  formatModuleNotFoundError: vi.fn(() => ""),
}));

const { ModuleLoader, ModuleLoadError } = await import("../../../src/dev-server/module-loader");

const workDir = mkdtempSync(join(tmpdir(), "warlock-module-loader-"));

function fixture(name: string, source: string): string {
  const absolutePath = join(workDir, name);
  writeFileSync(absolutePath, source, "utf8");
  return absolutePath;
}

function fakeFile(absolutePath: string, relativePath: string): FileManager {
  const file = {
    relativePath,
    absolutePath,
    type: "route",
    cleanup: [] as Array<() => void>,
    addCleanup(hooks: (() => void) | Array<() => void>) {
      const next = Array.isArray(hooks) ? hooks : [hooks];
      file.cleanup.push(...next);
    },
    resetCleanup() {
      file.cleanup = [];
    },
  };

  return file as unknown as FileManager;
}

function collectorWith(byType: Partial<Record<string, FileManager[]>>): SpecialFilesCollector {
  return {
    getFilesByType: vi.fn((type: string) => byType[type] ?? []),
    getFileType: vi.fn(() => null),
  } as unknown as SpecialFilesCollector;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("ModuleLoader.loadModule — failure surfacing", () => {
  it("rethrows (as ModuleLoadError) when a route module throws on load", async () => {
    const path = fixture(
      "throwing-route.mjs",
      `throw new Error("route registration blew up");`,
    );
    const file = fakeFile(path, "src/app/store/routes.ts");
    const loader = new ModuleLoader(collectorWith({}));

    await expect(loader.loadModule(file, "route")).rejects.toBeInstanceOf(ModuleLoadError);
    await expect(loader.loadModule(file, "route")).rejects.toThrow(/route registration blew up/);
  });

  it("preserves the failing file and original cause on the error", async () => {
    const path = fixture("throwing-route-2.mjs", `throw new Error("nope");`);
    const file = fakeFile(path, "src/app/blog/routes.ts");
    const loader = new ModuleLoader(collectorWith({}));

    const error = await loader.loadModule(file, "route").catch((e) => e);

    expect(error).toBeInstanceOf(ModuleLoadError);
    expect((error as InstanceType<typeof ModuleLoadError>).file.relativePath).toBe(
      "src/app/blog/routes.ts",
    );
    expect((error as InstanceType<typeof ModuleLoadError>).type).toBe("route");
    expect(((error as InstanceType<typeof ModuleLoadError>).cause as Error).message).toBe("nope");
  });

  it("returns the module (no throw) when the route loads cleanly", async () => {
    const path = fixture("good-route.mjs", `export const ok = true;`);
    const file = fakeFile(path, "src/app/ok/routes.ts");
    const loader = new ModuleLoader(collectorWith({}));

    const module = await loader.loadModule<{ ok: boolean }>(file, "route");

    expect(module?.ok).toBe(true);
  });
});

describe("ModuleLoader.loadAll — aggregate boot failure", () => {
  it("attempts every file and throws an AggregateError listing each failure", async () => {
    const badA = fakeFile(
      fixture("bad-a.mjs", `throw new Error("A failed");`),
      "src/app/a/routes.ts",
    );
    const badB = fakeFile(
      fixture("bad-b.mjs", `throw new Error("B failed");`),
      "src/app/b/routes.ts",
    );
    const collector = collectorWith({ route: [badA, badB] });
    const loader = new ModuleLoader(collector);

    const error = await loader.loadAll().catch((e) => e);

    expect(error).toBeInstanceOf(AggregateError);
    // Both files were attempted — one broken module does not hide the other.
    expect((error as AggregateError).errors).toHaveLength(2);
    expect((error as AggregateError).message).toMatch(/a\/routes\.ts/);
    expect((error as AggregateError).message).toMatch(/b\/routes\.ts/);
  });

  it("resolves without throwing when every file loads cleanly", async () => {
    const good = fakeFile(
      fixture("all-good.mjs", `export const ok = true;`),
      "src/app/ok/routes.ts",
    );
    const collector = collectorWith({ route: [good] });
    const loader = new ModuleLoader(collector);

    await expect(loader.loadAll()).resolves.toBeUndefined();
  });
});

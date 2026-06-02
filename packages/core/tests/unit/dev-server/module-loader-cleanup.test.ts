import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileManager } from "../../../src/dev-server/file-manager";
import type { SpecialFilesCollector } from "../../../src/dev-server/special-files-collector";

/**
 * ModuleLoader pulls in the router singleton and the dev logger at import
 * time. Both are mocked so these tests can focus on the cleanup-hook
 * lifecycle without booting routing or printing to the console.
 */
const routerMock = vi.hoisted(() => ({
  removeRoutesBySourceFile: vi.fn(),
  withSourceFile: vi.fn(),
}));

vi.mock("../../../src/router/router", () => ({ router: routerMock }));
vi.mock("../../../src/dev-server/dev-logger", () => ({
  devLogError: vi.fn(),
  formatModuleNotFoundError: vi.fn(() => ""),
}));

const { ModuleLoader } = await import("../../../src/dev-server/module-loader");

/**
 * Minimal FileManager honouring just the cleanup contract ModuleLoader uses:
 * a `cleanup` array plus add/reset helpers and the routing-relevant fields.
 */
function fakeFile(overrides: Partial<FileManager> = {}): FileManager {
  const file = {
    relativePath: "src/app/store/service.ts",
    absolutePath: "/abs/src/app/store/service.ts",
    type: "service",
    cleanup: [] as Array<() => void>,
    addCleanup(hooks: (() => void) | Array<() => void>) {
      const next = Array.isArray(hooks) ? hooks : [hooks];
      file.cleanup.push(...next);
    },
    resetCleanup() {
      file.cleanup = [];
    },
    ...overrides,
  };

  return file as unknown as FileManager;
}

function loader(): InstanceType<typeof ModuleLoader> {
  const collector = {
    getFileType: vi.fn(() => null),
  } as unknown as SpecialFilesCollector;

  return new ModuleLoader(collector);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ModuleLoader.runCleanup", () => {
  it("invokes every registered function hook", () => {
    const calls: string[] = [];
    const file = fakeFile({
      cleanup: [() => calls.push("a"), () => calls.push("b")],
    } as Partial<FileManager>);

    loader().runCleanup(file);

    expect(calls).toEqual(["a", "b"]);
  });

  it("calls .unsubscribe() on subscription-style hooks", () => {
    const unsubscribe = vi.fn();
    const file = fakeFile({ cleanup: [{ unsubscribe } as unknown as () => void] });

    loader().runCleanup(file);

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("swallows a throwing hook and still resets the list", () => {
    const file = fakeFile({
      cleanup: [
        () => {
          throw new Error("cleanup blew up");
        },
      ],
    });

    expect(() => loader().runCleanup(file)).not.toThrow();
    expect(file.cleanup).toEqual([]);
  });

  it("empties the cleanup list afterwards", () => {
    const file = fakeFile({ cleanup: [vi.fn()] });

    loader().runCleanup(file);

    expect(file.cleanup).toEqual([]);
  });
});

describe("ModuleLoader.cleanupDeletedModule", () => {
  it("removes routes for a deleted route file", () => {
    const file = fakeFile({ type: "route", relativePath: "src/app/store/routes.ts" });

    loader().cleanupDeletedModule(file);

    expect(routerMock.removeRoutesBySourceFile).toHaveBeenCalledWith("src/app/store/routes.ts");
  });

  it("does not touch the router for a non-route file", () => {
    const file = fakeFile({ type: "service" });

    loader().cleanupDeletedModule(file);

    expect(routerMock.removeRoutesBySourceFile).not.toHaveBeenCalled();
  });

  it("runs the file's cleanup hooks", () => {
    const hook = vi.fn();
    const file = fakeFile({ type: "service", cleanup: [hook] });

    loader().cleanupDeletedModule(file);

    expect(hook).toHaveBeenCalledOnce();
  });
});

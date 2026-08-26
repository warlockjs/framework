import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearPositionalHandlerSuspects,
  listPositionalHandlerSuspects,
} from "../../../src/router/positional-handler-diagnostics";
import { Router } from "../../../src/router/router";
import type { Route } from "../../../src/router/types";

const router = Router.getInstance();

let sequence = 0;
let testKey = "";
let touchedSourceFiles: Set<string>;

function source(label: string) {
  const sourceFile = `${testKey}/${label}.ts`;
  touchedSourceFiles.add(sourceFile);
  return sourceFile;
}

function path(label: string) {
  return `/${testKey}/${label}`;
}

function routesFor(...sourceFiles: string[]): Route[] {
  const owners = new Set(sourceFiles);
  return router.list().filter((route) => owners.has(route.sourceFile));
}

function routesVersion() {
  return (router as unknown as { routesVersion: number }).routesVersion;
}

async function register(sourceFile: string, callback: () => void) {
  await router.withSourceFile(sourceFile, callback);
}

beforeEach(() => {
  testKey = `route-source-transaction-${sequence++}`;
  touchedSourceFiles = new Set();
  clearPositionalHandlerSuspects();
});

afterEach(() => {
  for (const sourceFile of touchedSourceFiles) {
    router.removeRoutesBySourceFile(sourceFile);
  }

  clearPositionalHandlerSuspects();
});

describe("Router.replaceRoutesBySourceFiles", () => {
  it("preserves unrelated routes and their relative order", async () => {
    const beforeOwner = source("before");
    const replacedOwner = source("replaced");
    const afterOwner = source("after");

    await register(beforeOwner, () => router.get(path("before"), () => undefined as any));
    await register(replacedOwner, () => router.get(path("old"), () => undefined as any));
    await register(afterOwner, () => router.get(path("after"), () => undefined as any));

    const unrelatedBefore = routesFor(beforeOwner, afterOwner);

    await router.replaceRoutesBySourceFiles([replacedOwner], () =>
      register(replacedOwner, () => router.get(path("new"), () => undefined as any)),
    );

    const unrelatedAfter = routesFor(beforeOwner, afterOwner);

    expect(unrelatedAfter).toEqual(unrelatedBefore);
    expect(unrelatedAfter[0]).toBe(unrelatedBefore[0]);
    expect(unrelatedAfter[1]).toBe(unrelatedBefore[1]);
    expect(routesFor(replacedOwner).map((route) => route.path)).toEqual([path("new")]);
  });

  it("keeps the old table and diagnostics visible across awaits, then commits once", async () => {
    const owner = source("awaited");
    const oldPath = path("old-visible");
    const newPath = path("new-visible");

    await register(owner, () =>
      router.get(
        oldPath,
        ((request: any, response: any) => [request, response]) as any,
        { name: `${testKey}.visible` },
      ),
    );

    const oldTable = router.list();
    const versionBefore = routesVersion();
    let releaseInstall!: () => void;
    let signalInstallReached!: () => void;
    const installGate = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });
    const installReached = new Promise<void>((resolve) => {
      signalInstallReached = resolve;
    });

    const replacement = router.replaceRoutesBySourceFiles([owner], async () => {
      await register(owner, () =>
        router.get(
          newPath,
          ((request: any, response: any) => [request, response]) as any,
          { name: `${testKey}.visible` },
        ),
      );
      signalInstallReached();
      await installGate;
    });

    await installReached;

    expect(router.list()).toBe(oldTable);
    expect(routesFor(owner).map((route) => route.path)).toEqual([oldPath]);
    expect(routesVersion()).toBe(versionBefore);
    expect(listPositionalHandlerSuspects().map((suspect) => suspect.path)).toEqual([oldPath]);

    releaseInstall();
    await replacement;

    expect(router.list()).not.toBe(oldTable);
    expect(routesFor(owner).map((route) => route.path)).toEqual([newPath]);
    expect(routesVersion()).toBe(versionBefore + 1);
    expect(listPositionalHandlerSuspects().map((suspect) => suspect.path)).toEqual([newPath]);
  });

  it("rolls back exactly when install throws before adding a route", async () => {
    const owner = source("throw-before-add");

    await register(owner, () => router.get(path("old"), () => undefined as any));

    const oldTable = router.list();
    const oldRoutes = [...oldTable];
    const versionBefore = routesVersion();

    await expect(
      router.replaceRoutesBySourceFiles([owner], () => {
        throw new Error("install failed before add");
      }),
    ).rejects.toThrow("install failed before add");

    expect(router.list()).toBe(oldTable);
    expect(router.list()).toEqual(oldRoutes);
    expect(router.list().every((route, index) => route === oldRoutes[index])).toBe(true);
    expect(routesVersion()).toBe(versionBefore);
  });

  it("rolls back the first draft add when a later add collides", async () => {
    const owner = source("collision-owner");
    const unrelatedOwner = source("collision-unrelated");
    const collisionName = `${testKey}.collision`;

    await register(owner, () => router.get(path("old"), () => undefined as any));
    await register(unrelatedOwner, () =>
      router.get(path("claimant"), () => undefined as any, { name: collisionName }),
    );

    const oldTable = router.list();
    const oldRoutes = [...oldTable];
    const versionBefore = routesVersion();

    await expect(
      router.replaceRoutesBySourceFiles([owner], () =>
        register(owner, () => {
          router.get(path("draft-first"), () => undefined as any);
          router.get(path("draft-collision"), () => undefined as any, { name: collisionName });
        }),
      ),
    ).rejects.toThrow(`Route name "${collisionName}" is already taken`);

    expect(router.list()).toBe(oldTable);
    expect(router.list()).toEqual(oldRoutes);
    expect(router.list().some((route) => route.path === path("draft-first"))).toBe(false);
    expect(routesVersion()).toBe(versionBefore);
  });

  it("commits a replacement that deletes the table to zero routes", async () => {
    const owner = source("delete-to-zero");

    await register(owner, () => router.get(path("only"), () => undefined as any));
    expect(router.routeCount()).toBe(1);
    const versionBefore = routesVersion();

    await router.replaceRoutesBySourceFiles([owner], () => undefined);

    expect(router.list()).toEqual([]);
    expect(router.routeCount()).toBe(0);
    expect(routesVersion()).toBe(versionBefore + 1);
  });

  it("rejects a nested transaction without disturbing the outer draft", async () => {
    const owner = source("outer");
    const nestedOwner = source("nested");

    await register(owner, () => router.get(path("old"), () => undefined as any));
    const versionBefore = routesVersion();

    await router.replaceRoutesBySourceFiles([owner], async () => {
      await register(owner, () => router.get(path("outer-new"), () => undefined as any));

      await expect(
        router.replaceRoutesBySourceFiles([nestedOwner], () => undefined),
      ).rejects.toThrow("Cannot nest route replacement transactions");
    });

    expect(routesFor(owner).map((route) => route.path)).toEqual([path("outer-new")]);
    expect(routesVersion()).toBe(versionBefore + 1);
  });
});

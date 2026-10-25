import { afterEach, describe, expect, it } from "vitest";
import { MemoryCacheDriver, cache } from "@warlock.js/cache";
import { requestContext } from "../http/context/request-context";
import { router } from "../router/router";
import { captureTestRouterSnapshot, resetTestRuntimeState } from "./reset-test-state";

const handler = ({ response }: { response: { success: (data: object) => unknown } }) =>
  response.success({});

function paths(): string[] {
  return router.list().map((route) => route.path);
}

afterEach(() => {
  router.removeRoutesBySourceFile("reset-state-spec");
});

describe("resetTestRuntimeState", () => {
  it("removes routes a file registered after the boot snapshot and keeps the app's", async () => {
    await router.withSourceFile("reset-state-spec", () => {
      router.get("/reset-state-app", handler as never);
    });
    await captureTestRouterSnapshot();

    await router.withSourceFile("reset-state-spec", () => {
      router.get("/reset-state-leaked", handler as never);
    });
    expect(paths()).toContain("/reset-state-leaked");

    const report = await resetTestRuntimeState();

    expect(report.routesRestored).toBe(true);
    expect(paths()).toContain("/reset-state-app");
    expect(paths()).not.toContain("/reset-state-leaked");
  });

  it("is a no-op for the route table when nothing changed since the snapshot", async () => {
    await captureTestRouterSnapshot();
    const before = router.list();

    await resetTestRuntimeState();

    expect(router.list()).toBe(before);
  });

  it("leaves a request context a file entered", async () => {
    requestContext.enter({ request: { id: "leaked" } as never, response: {} as never });
    expect(requestContext.getRequest()).toBeDefined();

    await resetTestRuntimeState();

    expect(requestContext.getRequest()).toBeUndefined();
  });

  it("empties a real in-memory cache but not other drivers", async () => {
    const driver = new MemoryCacheDriver();

    driver.setOptions({});
    await driver.connect();
    await cache.use(driver);
    await cache.set("reset-state-key", "value");

    const report = await resetTestRuntimeState();

    expect(report.cacheFlushed).toBe(true);
    expect(await cache.get("reset-state-key")).toBeFalsy();
    await driver.disconnect();
  });
});

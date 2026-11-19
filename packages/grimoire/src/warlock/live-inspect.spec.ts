import { describe, expect, it, vi } from "vitest";
import { shopRoot } from "../../tests/fixtures/shop-facts";
import { createWarlockAdapter, liveInspect, type LiveInspectTooling } from "./adapter";

describe("the live inspect", () => {
  it("reads the running process's registries and never boots the app", async () => {
    const boot = vi.fn();
    const inspectApp = vi.fn(async () => ({ routes: [] }) as never);
    const tooling: LiveInspectTooling & { bootForInspect: typeof boot } = {
      inspectApp,
      liveInspectOptions: () => ({
        events: [
          { event: "order.created", name: "notify", sourceFile: "src/app/orders/events/notify.ts" },
        ],
      }),
      bootForInspect: boot,
    };
    const inspect = liveInspect(async () => tooling);

    await inspect("/app", ["routes", "events"]);

    expect(boot).not.toHaveBeenCalled();
    expect(inspectApp).toHaveBeenCalledTimes(1);
    expect(inspectApp).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/app",
        sections: ["routes", "events"],
        events: expect.any(Array),
      }),
    );
  });

  it("is what the adapter uses with live: true, and an explicit inspect still wins", async () => {
    const explicit = vi.fn(async () => ({ routes: [] }) as never);
    const adapter = createWarlockAdapter({ live: true, inspect: explicit });

    expect(await adapter.routes?.(shopRoot)).toEqual([]);
    expect(explicit).toHaveBeenCalledWith(shopRoot, ["routes"]);
  });
});

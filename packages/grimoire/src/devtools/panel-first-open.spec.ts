import { setConfig } from "@warlock.js/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShopAdapter } from "../../tests/fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "../../tests/support/copy-fixture";
import { grimoireDevtoolsPanel } from "./index";

/** The tooling the default adapter loads, with the boot pass and the live reads observed. */
const tooling = vi.hoisted(() => ({
  bootForInspect: vi.fn(async () => {
    throw new Error("the panel must never boot the app");
  }),
  liveInspectOptions: vi.fn(() => ({ events: [] })),
  inspectSections: [] as string[][],
  failFiles: false,
}));

vi.mock("@warlock.js/core/tooling", async (importOriginal) => {
  const real = await importOriginal<typeof import("@warlock.js/core/tooling")>();

  return {
    ...real,
    bootForInspect: tooling.bootForInspect,
    liveInspectOptions: tooling.liveInspectOptions,
    inspectApp: async (options: Parameters<typeof real.inspectApp>[0]) => {
      tooling.inspectSections.push([...(options?.sections ?? [])]);

      return real.inspectApp(options);
    },
    collectFiles: (...args: Parameters<typeof real.collectFiles>) => {
      if (tooling.failFiles) throw new Error("the disk is gone");

      return real.collectFiles(...args);
    },
  };
});

let copy: FixtureCopy | null = null;

afterEach(() => {
  copy?.remove();
  copy = null;
  tooling.bootForInspect.mockClear();
  tooling.liveInspectOptions.mockClear();
  tooling.inspectSections.length = 0;
  tooling.failFiles = false;
});

const request = { query: {}, params: {} } as never;

// The fixture has two sites; their page routes need `web.sites`, which the dev server has loaded.
beforeEach(() => {
  setConfig("web", {
    sites: {
      client: { hosts: ["shop.test"] },
      admin: { hosts: ["shop.test"], basePath: "/admin" },
    },
  });
});

afterEach(() => setConfig("web", undefined));

describe("the panel's first open", () => {
  it("builds once for the three first calls, and a custom adapter is not called before the first request", async () => {
    copy = copyFixture();
    const adapter = createShopAdapter();
    const panel = await grimoireDevtoolsPanel({ root: copy.root, adapter });

    expect(adapter.calls.files).toBe(0);

    const summary = panel.routes?.find((route) => route.path === "/summary");
    const features = panel.routes?.find((route) => route.path === "/features");

    await Promise.all([
      summary?.handler({ query: {}, params: {} } as never),
      features?.handler({ query: {}, params: {} } as never),
      summary?.handler({ query: {}, params: {} } as never),
    ]);

    expect(adapter.calls.files).toBe(1);
  });

  it("in development with the default adapter, reads the live facts once and never boots the app", async () => {
    copy = copyFixture();
    const panel = await grimoireDevtoolsPanel({ root: copy.root, mode: "development" });
    const summary = panel.routes?.find((route) => route.path === "/summary");

    // The book is warmed in the background at registration, before any request.
    await vi.waitFor(() => expect(tooling.liveInspectOptions).toHaveBeenCalled(), {
      timeout: 15_000,
    });

    const answers = (await Promise.all([summary?.handler(request), summary?.handler(request)])) as {
      routes?: string;
    }[];

    expect(answers.map((answer) => answer.routes)).toEqual(["fresh", "fresh"]);
    expect(tooling.bootForInspect).not.toHaveBeenCalled();
    // One live read of the routes and one of the named facts for the first open, shared by every call.
    expect(tooling.inspectSections.filter((sections) => sections.includes("routes"))).toHaveLength(
      1,
    );
    expect(tooling.inspectSections.filter((sections) => sections.includes("events"))).toHaveLength(
      1,
    );
  }, 30_000);

  it("swallows a failing background warm-up and reports the failure on the request instead", async () => {
    copy = copyFixture();
    tooling.failFiles = true;

    const unhandled = vi.fn();

    process.on("unhandledRejection", unhandled);

    try {
      const panel = await grimoireDevtoolsPanel({ root: copy.root, mode: "development" });
      const summary = panel.routes?.find((route) => route.path === "/summary");

      await expect(summary?.handler(request)).rejects.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(unhandled).not.toHaveBeenCalled();
      expect(tooling.bootForInspect).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

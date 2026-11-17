import { readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createShopAdapter } from "../../tests/fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "../../tests/support/copy-fixture";
import { grimoireDevtoolsPanel } from "./index";

let copy: FixtureCopy | null = null;

afterEach(() => {
  copy?.remove();
  copy = null;
});

/** Every file and folder under `root`, relative and sorted. */
function listing(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.split(path.sep).join("/"))
    .sort();
}

describe("the Grimoire devtools panel", () => {
  it("declares itself safe for the production monitor", async () => {
    copy = copyFixture();

    const panel = await grimoireDevtoolsPanel({ root: copy.root, mode: "production" });

    expect(panel.production).toBe(true);
    expect(panel.id).toBe("grimoire");
  });

  it("writes no file when the dashboard runs in production", async () => {
    copy = copyFixture();
    const before = listing(copy.root);
    const panel = await grimoireDevtoolsPanel({
      root: copy.root,
      mode: "production",
      adapter: createShopAdapter(),
    });
    const summary = panel.routes?.find((route) => route.path === "/summary");

    await summary?.handler({ params: {}, query: {}, body: undefined });

    expect(listing(copy.root)).toEqual(before);
  });

  it("keeps the generated book up to date in development", async () => {
    copy = copyFixture();
    const before = listing(copy.root);
    const panel = await grimoireDevtoolsPanel({
      root: copy.root,
      mode: "development",
      adapter: createShopAdapter(),
    });
    const summary = panel.routes?.find((route) => route.path === "/summary");

    await summary?.handler({ params: {}, query: {}, body: undefined });

    expect(listing(copy.root).length).toBeGreaterThan(before.length);
  });
});

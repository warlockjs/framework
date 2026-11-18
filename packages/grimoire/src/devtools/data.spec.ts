import { afterEach, describe, expect, it } from "vitest";
import { createShopAdapter } from "../../tests/fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "../../tests/support/copy-fixture";
import type { GrimoireAppsAnswer, GrimoireFeaturesAnswer, GrimoireSummary } from "./data";
import { grimoireDevtoolsPanel } from "./index";

let copy: FixtureCopy | null = null;

afterEach(() => {
  copy?.remove();
  copy = null;
});

async function answer<Result>(route: string): Promise<Result> {
  copy = copyFixture();

  const panel = await grimoireDevtoolsPanel({
    root: copy.root,
    mode: "production",
    adapter: createShopAdapter(),
  });
  const found = panel.routes?.find((item) => item.path === route);

  return (await found?.handler({ params: {}, query: {}, body: undefined })) as Result;
}

describe("the listing routes of the Grimoire tab", () => {
  it("lists the features with their summary and flow headings", async () => {
    const { features } = await answer<GrimoireFeaturesAnswer>("/features");
    const catalog = features.find((feature) => feature.id === "catalog");

    expect(features.length).toBeGreaterThan(1);
    expect(catalog?.title).toBeTruthy();
    expect(catalog?.flows.length).toBeGreaterThan(0);
    expect(catalog?.flows.every((flow) => "heading" in flow)).toBe(true);
    expect(catalog?.flows.some((flow) => typeof flow.heading === "string")).toBe(true);
  });

  it("gives every page and screen a row with its route and whether it is confirmed", async () => {
    const { apps } = await answer<GrimoireAppsAnswer>("/apps");
    const client = apps.find((app) => app.id === "web-client");

    expect(client?.rows.map((row) => row.id).sort()).toEqual(
      [...(client?.pages ?? []), ...(client?.screens ?? [])].sort(),
    );

    const home = client?.rows.find((row) => row.id === "home");

    expect(home?.route).toBe("/");
    expect(home?.type).toBe("page");
    expect(home?.blocks).toBeGreaterThan(0);
    expect(home?.origin === null || ["confirmed", "inferred"].includes(home?.origin ?? "")).toBe(
      true,
    );
  });

  it("counts apps, pages, screens and releases in the summary", async () => {
    const summary = await answer<GrimoireSummary>("/summary");

    expect(summary.apps.apps).toBeGreaterThan(0);
    expect(summary.apps.pages).toBeGreaterThan(0);
    expect(summary.releases).toBeGreaterThanOrEqual(0);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { createShopAdapter } from "../../tests/fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "../../tests/support/copy-fixture";
import { openGrimoire } from "../workspace";
import { flowHealth, flowOrder, neighboursOf, stepFilePage, stepFileSet } from "./compact";
import { scry } from "./query";

let copy: FixtureCopy | null = null;

afterEach(() => {
  copy?.remove();
  copy = null;
});

async function open() {
  copy = copyFixture();

  return openGrimoire(copy.root, createShopAdapter(), { routes: "fresh", write: false });
}

describe("the compact flow helpers", () => {
  it("orders flows by the README list, then file order, and finds neighbours", async () => {
    const snapshot = await open();
    const feature = snapshot.written.features.find((item) => item.id === "catalog");

    if (feature === undefined) throw new Error("fixture has no catalog feature");

    const order = flowOrder(feature);

    expect(order).toHaveLength(feature.flows.length);

    const first = order[0]?.id.value ?? "";

    expect(neighboursOf(feature, first).previous).toBeNull();
    expect(neighboursOf(feature, "nope")).toEqual({ previous: null, next: null });
  });

  it("counts criteria by status and steps resolved", async () => {
    const snapshot = await open();
    const result = scry(snapshot, { type: "flow", feature: "catalog", flow: "new-arrivals" });

    if (result.type !== "flow") throw new Error("expected a flow answer");

    const health = flowHealth(result);

    expect(health.criteria.total).toBe(result.bookmap.criteria.length);
    expect(Object.values(health.criteria.byStatus).reduce((a, b) => a + b, 0)).toBe(
      health.criteria.total,
    );
    expect(health.steps.resolved).toBeLessThanOrEqual(health.steps.total);
  });

  it("sorts a step's files by module then path and pages them", async () => {
    const snapshot = await open();
    const bookmap = snapshot.collected.flows["catalog/new-arrivals"];
    const step = bookmap?.steps[1];

    if (bookmap === undefined || step === undefined)
      throw new Error("fixture flow has no second step");

    const sorted = stepFileSet(snapshot, "catalog", step, "reachable");

    expect(sorted).toHaveLength(step.files.length);

    const page = stepFilePage(snapshot, bookmap, step, "feature", 0, 2);

    expect(page.files.length).toBeLessThanOrEqual(2);
    expect(page.files.every((item) => item.owner === "catalog")).toBe(true);
  });
});

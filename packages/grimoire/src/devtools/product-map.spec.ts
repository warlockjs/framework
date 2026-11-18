import { afterEach, describe, expect, it, vi } from "vitest";
import { createShopAdapter } from "../../tests/fixtures/shop-facts";
import { checkGrimoire } from "../check";
import { copyFixture, type FixtureCopy } from "../../tests/support/copy-fixture";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import { openGrimoire } from "../workspace";
import { productFeature, productFlow, productMap, type ProductMapOptions } from "./product-map";

// The real check, counted: the answers must run it once per snapshot.
vi.mock("../check", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../check")>();

  return { ...actual, checkGrimoire: vi.fn(actual.checkGrimoire) };
});

let copy: FixtureCopy | null = null;

afterEach(() => {
  copy?.remove();
  copy = null;
});

async function open(): Promise<GrimoireSnapshot> {
  copy = copyFixture();

  return openGrimoire(copy.root, createShopAdapter(), { routes: "fresh", write: false });
}

const signedIn: ProductMapOptions = { shared: false, errors: null };
const shared: ProductMapOptions = { shared: true, errors: null };

describe("the product map answers", () => {
  it("lists every feature with plain summary, audience, apps and a health light", async () => {
    const snapshot = await open();
    const map = productMap(snapshot, signedIn);
    const catalog = map.features.find((feature) => feature.id === "catalog");

    expect(map.developer).toBe(true);
    expect(catalog?.title).toBeTruthy();
    expect(catalog?.audience.length).toBeGreaterThan(0);
    expect(catalog?.flows).toBeGreaterThan(0);
    expect(["good", "attention", "problem", "unknown"]).toContain(catalog?.health.level);
    expect(catalog?.health.reason).not.toBe("");
    expect(productMap(snapshot, shared).developer).toBe(false);
  });

  it("answers a feature with flows, appearances, releases and planned work", async () => {
    const snapshot = await open();
    const answer = productFeature(snapshot, "catalog", signedIn);

    expect(answer.feature.id).toBe("catalog");
    expect(answer.flows.map((flow) => flow.id)).toContain("new-arrivals");
    expect(answer.appearances.some((item) => item.flow === "catalog/new-arrivals")).toBe(true);
    expect(Array.isArray(answer.releases)).toBe(true);
    expect(Array.isArray(answer.planned)).toBe(true);
    expect(answer.developer?.files).toBeGreaterThan(0);
  });

  it("answers a flow with a story, proof and neighbours; derives the story from steps when none is written", async () => {
    const snapshot = await open();
    const answer = productFlow(snapshot, "catalog", "new-arrivals", signedIn);

    expect(answer.flow.ref).toBe("catalog/new-arrivals");
    expect(answer.story.length).toBeGreaterThan(0);
    expect(answer.proof.length).toBeGreaterThan(0);
    expect(answer.proof[0]?.tests).not.toBeNull();
    expect(answer.developer?.steps.length).toBeGreaterThan(0);
    expect(answer.developer?.steps[0]).not.toHaveProperty("files");
    expect(answer.cases.every((item) => !/^does not apply/i.test(item.answer))).toBe(true);
  });

  it("runs the check once per snapshot, however many pages are answered", async () => {
    const snapshot = await open();
    const feature = snapshot.written.features.find((item) => item.readme !== null);
    const flow = feature?.flows[0];

    vi.mocked(checkGrimoire).mockClear();
    productMap(snapshot, shared);
    productMap(snapshot, signedIn);

    if (feature !== undefined) productFeature(snapshot, feature.id, shared);

    if (feature !== undefined && flow !== undefined) {
      productFlow(snapshot, feature.id, flow.id.value, shared);
    }

    expect(vi.mocked(checkGrimoire)).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for an unknown feature or flow and 400 for a missing one", async () => {
    const snapshot = await open();

    expect(() => productFeature(snapshot, "nope", signedIn)).toThrow(/No feature/);
    expect(() => productFlow(snapshot, "catalog", "nope", signedIn)).toThrow(/No flow/);
    expect(() => productFeature(snapshot, undefined, signedIn)).toThrow(/Missing/);
  });

  it("carries no file path, code or test name in a shared answer", async () => {
    const snapshot = await open();
    const answers: unknown[] = [productMap(snapshot, shared)];

    for (const feature of snapshot.written.features) {
      answers.push(productFeature(snapshot, feature.id, shared));

      for (const flow of feature.flows) {
        answers.push(productFlow(snapshot, feature.id, flow.id.value, shared));
      }
    }

    const text = JSON.stringify(answers);

    for (const forbidden of ["src/", ".ts", ".tsx", "grimoire/"]) {
      expect(text).not.toContain(forbidden);
    }

    const flow = productFlow(snapshot, "catalog", "new-arrivals", shared);

    expect(flow.developer).toBeNull();
    expect(flow.proof.every((item) => item.tests === null)).toBe(true);
    expect(productFeature(snapshot, "catalog", shared).developer).toBeNull();
  });

  it("says no results are recorded when proofs exist and no store was read", async () => {
    const snapshot = await open();
    const hasProofs = snapshot.proofs.length > 0;
    const answer = productFeature(snapshot, "catalog", signedIn);

    if (hasProofs && snapshot.results === null) {
      expect(["attention", "problem"]).toContain(answer.health.level);
    }

    const failing = {
      ...snapshot,
      collected: {
        ...snapshot.collected,
        flows: Object.fromEntries(
          Object.entries(snapshot.collected.flows).map(([ref, bookmap]) => [
            ref,
            { ...bookmap, criteria: bookmap.criteria.map((item) => ({ ...item, status: "fail" as const })) },
          ]),
        ),
      },
    } as GrimoireSnapshot;
    const health = productFeature(failing, "catalog", signedIn).health;

    expect(health.level).toBe("problem");
    expect(health.reason).toMatch(/^\d+ of \d+ checks fail$/);

    const passing = {
      ...snapshot,
      results: { schemaVersion: 1, updatedAt: "x", runner: "vitest", results: [] },
      collected: {
        ...snapshot.collected,
        flows: Object.fromEntries(
          Object.entries(snapshot.collected.flows).map(([ref, bookmap]) => [
            ref,
            { ...bookmap, criteria: bookmap.criteria.map((item) => ({ ...item, status: "pass" as const })) },
          ]),
        ),
      },
    } as GrimoireSnapshot;
    const good = productFeature(passing, "catalog", signedIn).health;

    expect(["good", "attention", "problem"]).toContain(good.level);
  });

  it("maps captured errors of the last hour to the features and flows that use the route", async () => {
    const snapshot = await open();
    const route = (snapshot.book.facts.routes ?? []).find(
      (item) => item.path.includes("new-arrivals"),
    );

    expect(route).toBeDefined();

    const now = Date.now();
    const errors = [
      { route: route?.path ?? "", status: 500, name: "Error", source: "request" as const, count: 3, firstSeen: now - 1000, lastSeen: now - 500 },
      { route: route?.path ?? "", status: 500, name: "Old", source: "request" as const, count: 9, firstSeen: now - 9_000_000, lastSeen: now - 8_000_000 },
      { route: null, status: null, name: "NoRoute", source: "log" as const, count: 5, firstSeen: now, lastSeen: now },
    ];
    const answer = productFlow(snapshot, "catalog", "new-arrivals", { shared: false, errors });

    expect(answer.health.errors).toEqual({ count: 3, lastSeen: now - 500 });
    expect(productFlow(snapshot, "catalog", "new-arrivals", signedIn).health.errors).toBeNull();
    expect(productFeature(snapshot, "catalog", { shared: false, errors }).health.errors?.count).toBe(3);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createShopAdapter } from "../../tests/fixtures/shop-facts";
import { checkGrimoire } from "../check";
import { copyFixture, type FixtureCopy } from "../../tests/support/copy-fixture";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import { openGrimoire } from "../workspace";
import {
  compareReleases,
  productFeature,
  productFlow,
  productMap,
  type ProductMapOptions,
} from "./product-map";

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

  it("gives each card the numbers of its health strip: flows, criteria, screenshots and findings", async () => {
    const snapshot = await open();
    const catalog = productMap(snapshot, shared).features.find(
      (feature) => feature.id === "catalog",
    );
    const strip = catalog?.strip;

    expect(strip?.flows.total).toBe(catalog?.flows);
    expect(strip?.flows.shipped).toBeLessThanOrEqual(strip?.flows.total ?? 0);
    expect(strip?.criteria.total).toBe(catalog?.health.criteria.total);
    expect(strip?.criteria.proven).toBe(catalog?.health.criteria.pass);
    expect(typeof strip?.criteria.measured).toBe("boolean");
    // A criterion with a result (pass, fail or stale) makes the strip measured.
    if ((catalog?.health.criteria.pass ?? 0) > 0) expect(strip?.criteria.measured).toBe(true);
    expect(strip?.screenshots.present).toBeLessThanOrEqual(strip?.screenshots.places ?? 0);
    expect(strip?.findings.errors).toBeGreaterThanOrEqual(0);
    expect(strip?.findings.warnings).toBeGreaterThanOrEqual(0);
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

  it("shows missing test results as neutral not-measured in the shared view and as attention for developers", async () => {
    const snapshot = await open();
    const unmeasured = {
      ...snapshot,
      results: null,
      proofs: snapshot.proofs.length > 0 ? snapshot.proofs : ([{}] as never),
      collected: {
        ...snapshot.collected,
        flows: Object.fromEntries(
          Object.entries(snapshot.collected.flows).map(([ref, bookmap]) => [
            ref,
            {
              ...bookmap,
              criteria: bookmap.criteria.map((item) => ({ ...item, status: "pass" as const })),
            },
          ]),
        ),
      },
    } as GrimoireSnapshot;
    const business = productFeature(unmeasured, "catalog", shared).health;
    const developer = productFeature(unmeasured, "catalog", signedIn).health;

    if (business.criteria.total > 0) {
      expect(business.level).toBe("unknown");
      expect(business.reason).toBe("Test results are not measured");
      expect(developer.level).toBe("attention");
      expect(developer.reason).toBe("No test results recorded");
    }
  });

  it("gives each card the day it last changed and the releases that name it, and lists the releases", async () => {
    const snapshot = await open();
    const map = productMap(snapshot, shared);

    for (const feature of map.features) {
      expect(feature.changedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(feature.changedIn)).toBe(true);
      expect(typeof feature.unreleased).toBe("boolean");
    }

    const dates = map.releases.map((item) => item.date);

    expect(dates).toEqual([...dates].sort());
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
            {
              ...bookmap,
              criteria: bookmap.criteria.map((item) => ({ ...item, status: "fail" as const })),
            },
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
            {
              ...bookmap,
              criteria: bookmap.criteria.map((item) => ({ ...item, status: "pass" as const })),
            },
          ]),
        ),
      },
    } as GrimoireSnapshot;
    const good = productFeature(passing, "catalog", signedIn).health;

    expect(["good", "attention", "problem"]).toContain(good.level);
  });

  it("maps captured errors of the last hour to the features and flows that use the route", async () => {
    const snapshot = await open();
    const route = (snapshot.book.facts.routes ?? []).find((item) =>
      item.path.includes("new-arrivals"),
    );

    expect(route).toBeDefined();

    const now = Date.now();
    const errors = [
      {
        route: route?.path ?? "",
        status: 500,
        name: "Error",
        source: "request" as const,
        count: 3,
        firstSeen: now - 1000,
        lastSeen: now - 500,
      },
      {
        route: route?.path ?? "",
        status: 500,
        name: "Old",
        source: "request" as const,
        count: 9,
        firstSeen: now - 9_000_000,
        lastSeen: now - 8_000_000,
      },
      {
        route: null,
        status: null,
        name: "NoRoute",
        source: "log" as const,
        count: 5,
        firstSeen: now,
        lastSeen: now,
      },
    ];
    const answer = productFlow(snapshot, "catalog", "new-arrivals", { shared: false, errors });

    expect(answer.health.errors).toEqual({ count: 3, lastSeen: now - 500 });
    expect(productFlow(snapshot, "catalog", "new-arrivals", signedIn).health.errors).toBeNull();
    expect(
      productFeature(snapshot, "catalog", { shared: false, errors }).health.errors?.count,
    ).toBe(3);
  });
});

describe("product map dates and release order", () => {
  it("ignores an updated value that is not a day, so every card keeps a valid changedAt", async () => {
    const snapshot = await open();
    const feature = snapshot.written.features.find((item) => item.readme !== null);

    if (feature?.readme === undefined || feature.readme === null) throw new Error("no readme");

    feature.readme.updated = { ...feature.readme.updated, value: "soon" };
    feature.changelog = null;

    const card = productMap(snapshot, shared).features.find((item) => item.id === feature.id);

    expect(card?.changedAt).toBe("");
  });

  it("compares releases by their numbers, so 5.9.0 comes before 5.10.0", () => {
    const names = ["5.10.0", "5.9.0", "5.2.1", "5.2.0"];

    expect([...names].sort(compareReleases)).toEqual(["5.2.0", "5.2.1", "5.9.0", "5.10.0"]);
  });
});

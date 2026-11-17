import { describe, expect, it } from "vitest";
import { createLocalInsights, createSharedInsights } from "../../../src/production/insights";
import { createMemoryStore } from "../../../src/production/store/memory-store";
import { errorGroup, fakeReporter, logEntry, report, route, shape } from "./helpers";

const NOW = 1_000_000;

async function setup() {
  const store = createMemoryStore();

  await store.reports.write(
    report("b", NOW - 5000, {
      queries: [
        shape("q1", [100, 200]),
        shape("q2", [5, 5, 5, 5], { nPlusOne: { requests: 3, maxPerRequest: 9 } }),
      ],
      routes: [route("GET /a", [10, 20], 1), route("GET /b", [500])],
      errors: [errorGroup("e1", NOW - 4000, 2)],
      logs: [logEntry(NOW - 4000, "error", "db")],
    }),
  );
  await store.reports.write(
    report("c", NOW - 1000, {
      queries: [shape("q1", [300])],
      routes: [route("GET /a", [30], 0)],
      errors: [errorGroup("e1", NOW - 500, 1), errorGroup("e2", NOW - 900)],
      logs: [logEntry(NOW - 100, "warn", "HTTP")],
    }),
  );
  // Too old for the views, still in the instances list.
  await store.reports.write(report("old", NOW - 120_000));
  // Too old for everything.
  await store.reports.write(report("gone", NOW - 400_000));

  const reporter = fakeReporter("a", () =>
    report("a", NOW, {
      queries: [shape("q1", [50])],
      routes: [route("GET /a", [40], 2)],
      logs: [logEntry(NOW - 50, "warn", "http")],
    }),
  );
  const insights = createSharedInsights({ store, reporter, sampleRate: 0.25 });

  return { store, insights, reporter };
}

describe("createSharedInsights", () => {
  it("lists instances seen in the last 5 minutes, newest first", async () => {
    const { insights } = await setup();
    const view = await insights.instances();

    expect(view.current).toBe("a");
    expect(view.instances.map((i) => i.id)).toEqual(["a", "c", "b", "old"]);
    expect(view.instances[0]!.seenAt).toBe(NOW);
  });

  it("merges only fresh reports and takes the answering instance live", async () => {
    const { insights, store } = await setup();

    // A stale stored row of the answering instance must not win over the live report.
    await store.reports.write(report("a", NOW - 30_000, { queries: [shape("stale", [1])] }));
    const view = await insights.queryStats({ instance: "all" });
    const q1 = view.shapes.find((s) => s.id === "q1")!;

    expect(view.instanceCount).toBe(3);
    expect(view.shapes.find((s) => s.id === "stale")).toBeUndefined();
    expect(q1.count).toBe(4);
    expect(q1.instances.sort()).toEqual(["a", "b", "c"]);
    expect(q1.meanMs).toBeCloseTo(162.5);
    expect(q1.p95Ms).toBeGreaterThan(q1.p50Ms);
    expect(view.sampleRate).toBe(0.25);
    expect(view.evicted).toBe(3);
  });

  it("selects one instance, and an unknown id gives an empty view", async () => {
    const { insights } = await setup();
    const one = await insights.routeStats({ instance: "b" });
    const none = await insights.routeStats({ instance: "nope" });
    const noRes = await insights.resources({ instance: "nope" });

    expect(one.instanceCount).toBe(1);
    expect(one.routes.map((r) => r.key)).toContain("GET /b");
    expect(none).toMatchObject({ routes: [], instanceCount: 0 });
    expect(noRes.instances).toEqual([]);
    expect((await insights.queryStats({ instance: "nope" })).shapes).toEqual([]);
  });

  it("sorts queries by total (default), p95, count and n+1", async () => {
    const { insights } = await setup();
    const ids = async (sort?: string) =>
      (await insights.queryStats({ instance: "b", ...(sort ? { sort } : {}) })).shapes.map(
        (s) => s.id,
      );

    expect(await ids()).toEqual(["q1", "q2"]);
    expect(await ids("total")).toEqual(["q1", "q2"]);
    expect(await ids("p95")).toEqual(["q1", "q2"]);
    expect(await ids("count")).toEqual(["q2", "q1"]);
    expect(await ids("n+1")).toEqual(["q2", "q1"]);
    expect(await ids("bogus")).toEqual(["q1", "q2"]);
  });

  it("sorts routes by total, p95, count and errors", async () => {
    const { insights } = await setup();
    const keys = async (sort: string) =>
      (await insights.routeStats({ instance: "all", sort })).routes.map((r) => r.key);

    expect(await keys("total")).toEqual(["GET /b", "GET /a"]);
    expect(await keys("count")).toEqual(["GET /a", "GET /b"]);
    expect(await keys("errors")).toEqual(["GET /a", "GET /b"]);
    expect(await keys("p95")).toEqual(["GET /b", "GET /a"]);
  });

  it("limits rows between 1 and 500, default 100", async () => {
    const store = createMemoryStore();
    const many = Array.from({ length: 150 }, (_, i) => shape(`s${i}`, [i + 1]));
    const reporter = fakeReporter("a", () => report("a", NOW, { queries: many }));
    const insights = createSharedInsights({ store, reporter, sampleRate: 1 });

    expect((await insights.queryStats({ instance: "all" })).shapes).toHaveLength(100);
    expect((await insights.queryStats({ instance: "all", limit: 7 })).shapes).toHaveLength(7);
    expect((await insights.queryStats({ instance: "all", limit: 0 })).shapes).toHaveLength(1);
    expect((await insights.queryStats({ instance: "all", limit: 9999 })).shapes).toHaveLength(150);
  });

  it("merges error groups across instances", async () => {
    const { insights } = await setup();
    const { groups } = await insights.errors({ instance: "all" });

    expect(groups.map((g) => g.id)).toEqual(["e1", "e2"]);
    expect(groups[0]!.count).toBe(3);
    expect(groups[0]!.instances.sort()).toEqual(["b", "c"]);
  });

  it("lists logs newest first with substring, case-insensitive filters", async () => {
    const { insights } = await setup();
    const all = await insights.logs({ instance: "all" });

    expect(all.map((l) => l.instance)).toEqual(["a", "c", "b"]);
    expect(
      (await insights.logs({ instance: "all", module: "http" })).map((l) => l.instance),
    ).toEqual(["a", "c"]);
    expect((await insights.logs({ instance: "all", level: "ERR" })).map((l) => l.instance)).toEqual(
      ["b"],
    );
    expect((await insights.logs({ instance: "c" })).every((l) => l.instance === "c")).toBe(true);
  });

  it("returns health, jobs and resources per instance", async () => {
    const { insights } = await setup();

    expect((await insights.health({ instance: "all" })).instances).toHaveLength(3);
    expect((await insights.jobs({ instance: "b" })).instances[0]!.instance.id).toBe("b");
    expect((await insights.resources({ instance: "c" })).instances[0]!.history).toHaveLength(2);
  });

  it("falls back to this process when the store fails", async () => {
    const { insights, store } = await setup();

    store.reports.list = async () => {
      throw new Error("db down");
    };
    expect((await insights.instances()).instances.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("createLocalInsights", () => {
  it("shows this process only, with its own sample rate", async () => {
    const reporter = fakeReporter("a", () =>
      report("a", NOW, {
        queries: [shape("q", [5])],
        capture: { ...report("a", 1).capture, sampleRate: 1 },
      }),
    );
    const insights = createLocalInsights(reporter);

    expect((await insights.instances()).instances).toHaveLength(1);
    expect(await insights.queryStats({ instance: "all" })).toMatchObject({
      sampleRate: 1,
      instanceCount: 1,
    });
    expect((await insights.queryStats({ instance: "other" })).shapes).toEqual([]);
  });
});

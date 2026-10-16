import { getObservers, isObserveAll, setAIConfig } from "@warlock.js/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// `clearObservers` is intentionally NOT on the core public barrel (it is
// test-only isolation); import it from the core source for spec cleanup.
import { clearObservers } from "../../../ai/src/observe/observer-registry";
import type { ExporterContract } from "../contracts/exporter.contract";
import { createInMemoryTraceStore } from "../store/in-memory-trace-store";
import { makeTrace } from "../test-support/make-trace";
import {
  applyPanopticConfig,
  getActiveDashboardHandle,
  resetAppliedPanopticConfig,
} from "./apply-panoptic-config";
import type { DashboardHandle } from "../dashboard/dashboard.type";

beforeEach(() => {
  clearObservers();
});

afterEach(async () => {
  await resetAppliedPanopticConfig();
  clearObservers();
});

describe("applyPanopticConfig", () => {
  it("is a no-op when config is undefined", () => {
    applyPanopticConfig(undefined);

    expect(getObservers()).toHaveLength(0);
    expect(isObserveAll()).toBe(false);
  });

  it("registers the collector as a core Observer", () => {
    const store = createInMemoryTraceStore();

    applyPanopticConfig({ exporters: [store as unknown as ExporterContract] });

    expect(getObservers()).toHaveLength(1);
  });

  it("sets observeAll from config", () => {
    applyPanopticConfig({ observeAll: true });

    expect(isObserveAll()).toBe(true);
  });

  it("routes a report through the registered observer into the store", async () => {
    const store = createInMemoryTraceStore();
    applyPanopticConfig({ exporters: [store as unknown as ExporterContract] });

    const [observer] = getObservers();
    await observer.collect({
      runId: "r1",
      rootRunId: "r1",
      name: "agent",
      type: "agent",
      status: "completed",
      startedAt: "2026-06-22T10:00:00.000Z",
      endedAt: "2026-06-22T10:00:01.000Z",
      duration: 1000,
      usage: { input: 1, output: 1, total: 2 },
      children: [],
    });

    expect(store.size).toBe(1);
    expect(store.get("r1")?.traceId).toBe("r1");
  });

  it("registers exactly one observer across repeated calls (idempotent)", () => {
    const store = createInMemoryTraceStore();

    applyPanopticConfig({ exporters: [store as unknown as ExporterContract] });
    applyPanopticConfig({ exporters: [store as unknown as ExporterContract] });
    applyPanopticConfig({ exporters: [store as unknown as ExporterContract] });

    expect(getObservers()).toHaveLength(1);
  });

  it("updates observeAll to the latest value on a repeat call", () => {
    applyPanopticConfig({ observeAll: true });
    expect(isObserveAll()).toBe(true);

    applyPanopticConfig({ observeAll: false });
    expect(isObserveAll()).toBe(false);
  });

  it("starts the dashboard over a supplied store when dashboard is set", async () => {
    const store = createInMemoryTraceStore();
    store.add(makeTrace({ traceId: "seeded" }));

    applyPanopticConfig({
      exporters: [store as unknown as ExporterContract],
      dashboard: { port: 0 },
    });

    // The dashboard starts asynchronously; poll until the handle lands.
    const handle = await waitForDashboard();

    expect(handle.port).toBeGreaterThan(0);

    const res = await fetch(`${handle.url}api/traces/seeded`);
    expect(res.status).toBe(200);
  });

  it("creates and registers a store when dashboard is set without one", async () => {
    applyPanopticConfig({ dashboard: { port: 0 } });

    // A store-exporter was created for the dashboard, plus the collector
    // registered as an observer.
    expect(getObservers()).toHaveLength(1);

    const handle = await waitForDashboard();
    const res = await fetch(`${handle.url}api/aggregate`);
    expect(res.status).toBe(200);
  });

  it("routes a cache-store failure to onError instead of swallowing it silently", async () => {
    const onError = vi.fn();
    const boom = new Error("ECONNREFUSED");

    applyPanopticConfig({
      cache: () => {
        throw boom;
      },
      dashboard: { port: 0 },
      onError,
    });

    // The dashboard still starts (hydration is best-effort) — proves the
    // failure didn't block startup, only that it must reach onError.
    await waitForDashboard();

    expect(onError).toHaveBeenCalledWith(boom);
  });

  it("reads ai.config().panoptic through setAIConfig + the seam", () => {
    // setAIConfig stores the opaque slot; applying it wires the observer.
    const store = createInMemoryTraceStore();
    setAIConfig({
      panoptic: { exporters: [store as unknown as ExporterContract], observeAll: true },
    });

    applyPanopticConfig({ exporters: [store as unknown as ExporterContract], observeAll: true });

    expect(getObservers()).toHaveLength(1);
    expect(isObserveAll()).toBe(true);
  });
});

/**
 * The dashboard starts on a microtask after `applyPanopticConfig`, so
 * await a short poll loop until its handle lands.
 */
async function waitForDashboard(): Promise<DashboardHandle> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const handle = getActiveDashboardHandle();
    if (handle !== undefined) {
      return handle;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("dashboard did not start in time");
}

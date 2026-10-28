import { describe, expect, it } from "vitest";
import { ReloadGate } from "./reload-gate";

describe("ReloadGate", () => {
  it("is open until a reload begins", async () => {
    const gate = new ReloadGate();

    expect(gate.closed).toBe(false);
    expect(await gate.waitUntilOpen(10)).toBe(true);
  });

  it("holds waiters until the reload ends", async () => {
    const gate = new ReloadGate();
    gate.begin();

    let resumed = false;
    const waiting = gate.waitUntilOpen(1_000).then((open) => {
      resumed = open;
    });

    await Promise.resolve();
    expect(resumed).toBe(false);

    gate.end();
    await waiting;

    expect(resumed).toBe(true);
    expect(gate.closed).toBe(false);
  });

  it("gives up after the cap so the caller can answer 503", async () => {
    const gate = new ReloadGate();
    gate.begin();

    expect(await gate.waitUntilOpen(10)).toBe(false);
  });

  it("stays closed until every nested begin has ended", () => {
    const gate = new ReloadGate();
    gate.begin();
    gate.begin();
    gate.end();

    expect(gate.closed).toBe(true);

    gate.end();

    expect(gate.closed).toBe(false);
  });

  it("drains in-flight requests before the reload continues", async () => {
    const gate = new ReloadGate();
    const leave = gate.enter();
    let drained = false;
    const draining = gate.drain(1_000).then((done) => {
      drained = done;
    });

    await Promise.resolve();
    expect(drained).toBe(false);

    leave();
    leave(); // idempotent
    await draining;

    expect(drained).toBe(true);
    expect(gate.activeRequests).toBe(0);
  });

  it("does not wait forever for a stuck request", async () => {
    const gate = new ReloadGate();
    gate.enter();

    expect(await gate.drain(10)).toBe(false);
  });
});

import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startHttpServer } from "../../../src/http/server";

// The first Fastify boot in the process costs far more than the 10s default on
// a cold transform cache; the assertions themselves resolve instantly.
vi.setConfig({ testTimeout: 120_000 });

/**
 * A numeric `http.trustProxy` grants NO trust — Fastify refuses hop-count trust
 * outright (`lib/request.js`, `getTrustProxyFn`) because a hop count cannot
 * validate the immediate peer. `detect-ip.test.ts` pins that behaviour.
 *
 * This file pins the OTHER half of the defect: that the inertness is announced.
 * Failing closed is safe but silent, and silence is what makes a number
 * dangerous — it reads like bounded trust, delivers none, and behind a real
 * proxy collapses ip-filter / rate-limit / idempotency scoping onto the proxy's
 * single address. Boot is the only honest moment to say so, because the value
 * never produces a visible symptom later.
 */
function bootWith(trustProxy: unknown): string[] {
  const warnings: string[] = [];
  const spy = vi.spyOn(log, "warn").mockImplementation(((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  }) as never);

  if (trustProxy !== undefined) {
    config.set("http.trustProxy", trustProxy);
  }

  try {
    startHttpServer();
  } finally {
    spy.mockRestore();
  }

  return warnings;
}

const trustProxyWarnings = (warnings: string[]) =>
  warnings.filter((line) => line.includes("http.trustProxy"));

describe("startHttpServer — inert numeric trustProxy is announced at boot", () => {
  afterEach(() => {
    config.unset("http.trustProxy");
  });

  it("warns that a hop count grants no trust, and names the number", () => {
    const warned = trustProxyWarnings(bootWith(1));

    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain("http.trustProxy is set to the number 1");
    expect(warned[0]).toMatch(/grants NO proxy trust/);
  });

  it("says what actually happens rather than only that the value is ignored", () => {
    const [warning] = trustProxyWarnings(bootWith(2));

    // The operator's real symptom: every client resolves to the proxy.
    expect(warning).toMatch(/request\.ip will stay the socket peer/);
    expect(warning).toMatch(/ip-filter allowlists, rate-limit buckets and idempotency scoping/);
    // ...and the fix, in the shape they should actually type.
    expect(warning).toMatch(/http\.trustProxy: "10\.0\.0\.0\/8"/);
  });

  it("warns for 0 too — a falsy hop count is just as inert, and easier to mistake for `false`", () => {
    expect(trustProxyWarnings(bootWith(0))).toHaveLength(1);
  });

  it.each([
    ["the default (unset)", undefined],
    ["false", false],
    ["true", true],
    ["a CIDR block", "10.0.0.0/8"],
    ["a list of blocks", ["10.0.0.0/8", "192.168.0.0/16"]],
    ["a predicate", () => true],
  ])("stays quiet for %s — only a number is inert", (_label, value) => {
    expect(trustProxyWarnings(bootWith(value))).toEqual([]);
  });
});

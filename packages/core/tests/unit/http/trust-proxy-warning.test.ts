import config from "@mongez/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startHttpServer } from "../../../src/http/server";

// The first Fastify boot in the process costs far more than the 10s default on
// a cold transform cache; the assertions themselves resolve instantly.
vi.setConfig({ testTimeout: 120_000 });

/** Pin the runtime boundary that narrows the untyped config-store value. */
function bootWith(trustProxy: unknown): ReturnType<typeof startHttpServer> {
  if (trustProxy !== undefined) {
    config.set("http.trustProxy", trustProxy);
  }

  return startHttpServer();
}

describe("startHttpServer — trustProxy configuration boundary", () => {
  afterEach(() => {
    config.unset("http.trustProxy");
  });

  it.each([
    ["an absent value", undefined],
    ["a cleared/null value", null],
  ])("defaults %s to no proxy trust", (_label, value) => {
    expect(() => bootWith(value)).not.toThrow();
  });

  it.each([
    ["false", false],
    ["true", true],
    ["a CIDR block", "10.0.0.0/8"],
    ["a list of blocks", ["10.0.0.0/8", "192.168.0.0/16"]],
    ["a predicate", () => true],
  ])("accepts %s", (_label, value) => {
    expect(() => bootWith(value)).not.toThrow();
  });

  it.each([
    ["a numeric hop count", 1, "number"],
    ["zero", 0, "number"],
    ["an empty string", "", "string"],
    ["an empty list", [], "array"],
    ["a mixed list", ["10.0.0.0/8", 1], "array"],
    ["an object", { address: "10.0.0.0/8" }, "object"],
  ])("rejects %s loudly", (_label, value, received) => {
    expect(() => bootWith(value)).toThrowError(
      new TypeError(
        "Invalid http.trustProxy configuration: expected a boolean, a non-empty IP/CIDR string, " +
          `a non-empty string array, or a predicate function; received ${received}.`,
      ),
    );
  });
});

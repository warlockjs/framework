/**
 * Urlencoded bodies are decoded in one pass and capped by field count, so a
 * body of tens of thousands of keys cannot hold the event loop.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseUrlencodedBody } from "./parse-urlencoded-body";

function body(keys: number): string {
  return Array.from({ length: keys }, (_, index) => `k${index}=v`).join("&");
}

describe("parseUrlencodedBody", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the shape: repeated keys become arrays, single keys stay strings", () => {
    expect(parseUrlencodedBody("a=1&b=2&a=3&c=")).toEqual({ a: ["1", "3"], b: "2", c: "" });
  });

  it("refuses more fields than the cap with a coded 413", () => {
    let thrown: unknown;

    try {
      parseUrlencodedBody(body(50_000));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ statusCode: 413, code: "EC107" });
    expect((thrown as Error).message).toMatch(/http\.urlencoded\.maxFields/);
  });

  it("counts repeats of one key toward the cap", () => {
    expect(() => parseUrlencodedBody("a=1&a=2&a=3", { maxFields: 2 })).toThrow(/maxFields/);
  });

  it("decodes tens of thousands of keys without a lookup per key", () => {
    const getAll = vi.spyOn(URLSearchParams.prototype, "getAll");
    const get = vi.spyOn(URLSearchParams.prototype, "get");

    const parsed = parseUrlencodedBody(body(50_000), { maxFields: 100_000 });

    expect(Object.keys(parsed)).toHaveLength(50_000);
    expect(getAll).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("never replaces the result's prototype", () => {
    const parsed = parseUrlencodedBody("__proto__=x&__proto__=y&a=1");

    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(parsed).toEqual({ a: "1" });
  });
});

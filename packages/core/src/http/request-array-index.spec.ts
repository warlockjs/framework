/**
 * Query, urlencoded and multipart keys must never name an array index above
 * `http.input.maxArrayIndex`: `set()` would turn `a[4294967294]=x` into a
 * sparse array of four billion slots that every later `map()` walks.
 */
import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import { Request } from "./request";

function parse(query: Record<string, unknown>) {
  const request = new Request();

  request.setRequest({
    method: "GET",
    url: "/x",
    headers: {},
    body: undefined,
    query,
    params: {},
  } as never);

  return request;
}

/** The longest array anywhere in a parsed value. */
function longestArray(value: unknown): number {
  if (Array.isArray(value)) {
    return Math.max(
      value.length,
      ...Object.keys(value).map((key) => longestArray(value[Number(key)])),
    );
  }

  if (value && typeof value === "object") {
    return Math.max(0, ...Object.values(value).map(longestArray));
  }

  return 0;
}

describe("array index cap in request parsing", () => {
  afterEach(() => config.set("http.input", undefined));

  it("drops every key shape that names a huge index", () => {
    const request = parse({
      "a[100000000]": "x",
      "b.5000": "y",
      "c[d][99999]": "z",
      "e[f][g][4294967294]": "w",
      "h[1001][name]": "v",
    });

    expect(longestArray(request.all())).toBeLessThanOrEqual(1001);
    expect(request.all()).not.toHaveProperty("a");
    expect(request.all()).not.toHaveProperty("b");
    expect(request.all()).not.toHaveProperty("c");
  });

  it("keeps indices within the cap", () => {
    const request = parse({ "a[3]": "x", "items[0][name]": "n", "b.2": "y" });

    expect((request.all() as any).a).toHaveLength(4);
    expect((request.all() as any).a[3]).toBe("x");
    expect(request.all()).toMatchObject({ items: [{ name: "n" }] });
    expect((request.all() as any).b[2]).toBe("y");
  });

  it("builds the log snapshot of an attack query without walking a sparse array", () => {
    const request = parse({ "a[4294967294]": "x" });

    expect(() => request.toLogSnapshot()).not.toThrow();
    expect(longestArray(request.all())).toBe(0);
  });

  it("reads the cap from http.input.maxArrayIndex", () => {
    config.set("http.input", { maxArrayIndex: 10 });

    const request = parse({ "a[11]": "x", "b[10]": "y" });

    expect(request.all()).not.toHaveProperty("a");
    expect((request.all() as any).b).toHaveLength(11);
  });
});

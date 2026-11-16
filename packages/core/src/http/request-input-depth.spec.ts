/**
 * Keys and JSON bodies are bounded by `http.input.maxDepth` so the nested
 * objects they build cannot make later walks recurse without limit.
 */
import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import { Request } from "./request";

function build(input: { query?: Record<string, unknown>; json?: unknown }) {
  const request = new Request();

  request.setRequest({
    method: "POST",
    url: "/x",
    headers: input.json === undefined ? {} : { "content-type": "application/json" },
    body: input.json,
    query: input.query ?? {},
    params: {},
  } as never);

  return request;
}

function nested(depth: number): unknown {
  let value: unknown = "leaf";

  for (let level = 1; level < depth; level++) value = { next: value };

  return value;
}

describe("input nesting depth", () => {
  afterEach(() => config.set("http.input", undefined));

  it("drops query keys nested deeper than the default of 32", () => {
    const deep = "a" + "[b]".repeat(40);
    const request = build({ query: { [deep]: "x", "ok[b][c]": "y" } });

    expect(request.all()).not.toHaveProperty("a");
    expect(request.all()).toEqual({ ok: { b: { c: "y" } } });
  });

  it("honours http.input.maxDepth for keys", () => {
    config.set("http.input", { maxDepth: 3 });

    const request = build({ query: { "a[b][c]": "1", "d[e][f][g]": "2" } });

    expect(request.all()).toEqual({ a: { b: { c: "1" } } });
  });

  it("refuses a JSON body nested deeper than the cap with a coded 400", () => {
    config.set("http.input", { maxDepth: 5 });

    expect(() => build({ json: nested(7) })).toThrow(
      expect.objectContaining({ statusCode: 400, code: "EC111" }),
    );
  });

  it("accepts a JSON body at the cap, arrays included", () => {
    config.set("http.input", { maxDepth: 5 });

    expect(() => build({ json: nested(6) })).not.toThrow();
    expect(() => build({ json: { list: [[[["x"]]]] } })).not.toThrow();
    expect(() => build({ json: { list: [[[[["x"]]]]] } })).toThrow();
  });

  it("walks a hostile body without recursing", () => {
    let hostile: unknown = "x";

    for (let level = 0; level < 200_000; level++) hostile = [hostile];

    expect(() => build({ json: hostile })).toThrow(expect.objectContaining({ code: "EC111" }));
  });
});

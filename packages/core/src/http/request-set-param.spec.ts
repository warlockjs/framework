/**
 * Real-Estate #17: the multi-site dispatcher matches a page on a single
 * `/*` route, then calls `request.setParam(key, value)` for each dynamic
 * segment it decodes from the matched path. `setParam` only wrote to
 * `payload.params`, but `request.input()` / `request.get()` read from
 * `payload.all`, which is composed once in `parsePayload()` — so a param
 * set after parsing never showed up through `input()`, only through the
 * `params` getter directly.
 *
 * `parsePayload()` composes `all` as `{ ...query, ...body, ...params }`,
 * i.e. params win over both query and body. `setParam` must replicate that
 * same precedence when it updates `all` after the fact.
 */
import { describe, expect, it } from "vitest";
import { Request } from "./request";

function parse(input: { query?: any; body?: any; params?: any }) {
  const request = new Request();

  request.setRequest({
    method: "GET",
    url: "/x",
    headers: {},
    body: input.body ?? {},
    query: input.query ?? {},
    params: input.params ?? {},
  } as never);

  (request as any).parsePayload();

  return request;
}

describe("Request.setParam keeps payload.all in sync", () => {
  it("makes input() see a param set after parsing", () => {
    const request = parse({});

    request.setParam("slug", "abc");

    expect(request.params.slug).toBe("abc");
    expect(request.input("slug")).toBe("abc");
    expect(request.get("slug")).toBe("abc");
    expect(request.has("slug")).toBe(true);
  });

  it("keeps params winning over an existing query value in all(), matching parsePayload's precedence", () => {
    const request = parse({ query: { slug: "from-query" } });

    request.setParam("slug", "from-param");

    expect(request.input("slug")).toBe("from-param");
    expect(request.all().slug).toBe("from-param");
  });

  it("keeps params winning over an existing body value in all(), matching parsePayload's precedence", () => {
    const request = parse({ body: { slug: "from-body" } });

    request.setParam("slug", "from-param");

    expect(request.input("slug")).toBe("from-param");
    expect(request.all().slug).toBe("from-param");
  });

  it("is reflected by only()/except(), which derive live from all()", () => {
    const request = parse({});

    request.setParam("slug", "abc");

    expect(request.only(["slug"])).toEqual({ slug: "abc" });
    expect(request.except(["other"])).toMatchObject({ slug: "abc" });
  });
});

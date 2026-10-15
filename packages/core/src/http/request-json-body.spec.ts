/**
 * JSON bodies pass through untouched, and `all()` uses the same precedence as
 * the validated input (body over query, params last) — findings B11, B12.
 */
import { describe, expect, it } from "vitest";
import { Request } from "./request";

function parse(input: { query?: any; body?: any; contentType?: string }) {
  const request = new Request();

  request.setRequest({
    method: "POST",
    url: "/x",
    headers: input.contentType ? { "content-type": input.contentType } : {},
    body: input.body,
    query: input.query ?? {},
    params: {},
  } as never);

  (request as any).parsePayload();

  return request;
}

describe("request body parsing", () => {
  it("keeps a JSON array body as an array", () => {
    const body = [{ a: 1 }, { a: 2 }];
    const request = parse({ body, contentType: "application/json" });

    expect(request.body).toEqual(body);
  });

  it("does not coerce or trim nested/top-level JSON strings", () => {
    const request = parse({
      body: { title: "null", flag: "true", password: "  pw " },
      contentType: "application/json; charset=utf-8",
    });

    expect(request.body).toEqual({ title: "null", flag: "true", password: "  pw " });
  });

  it("body wins over query in all(), matching allExceptParams()", () => {
    const request = parse({
      query: { role: "admin" },
      body: { role: "user" },
      contentType: "application/json",
    });

    expect(request.all().role).toBe("user");
    expect(request.allExceptParams().role).toBe("user");
  });

  it("never yields an undefined query for hostile keys", () => {
    const request = parse({ query: { "constructor[]": "1" } });

    expect(request.query).toEqual({});
  });
});

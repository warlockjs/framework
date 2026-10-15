/**
 * Body/query parsing must never write `__proto__`, `constructor` or
 * `prototype` path segments (prototype pollution, finding B1).
 */
import { describe, expect, it } from "vitest";
import { Request } from "./request";

function parse(input: { query?: any; body?: any }) {
  const request = new Request();

  request.setRequest({
    method: "GET",
    url: "/x",
    headers: {},
    body: input.body,
    query: input.query ?? {},
    params: {},
  } as never);

  return request;
}

const attacks: Record<string, any> = {
  "proto array-of-objects": { "__proto__[0][isAdmin]": "true" },
  "proto nested": { "__proto__[isAdmin]": "true" },
  "proto dotted": { "__proto__.isAdmin": "true" },
  "constructor prototype": { "constructor[prototype][isAdmin]": "true" },
  "constructor array-of-objects": { "constructor[0][isAdmin]": "true" },
  "second segment": { "a[__proto__][isAdmin]": "true" },
  "second segment indexed": { "a[0][__proto__]": "true", "a[0][constructor]": "true" },
  "deep": { "a[b][__proto__][isAdmin]": "true" },
};

describe("prototype pollution in request parsing", () => {
  for (const [name, payload] of Object.entries(attacks)) {
    it(`query: ${name}`, () => {
      const request = parse({ query: payload });

      (request as any).parsePayload();

      expect(({} as any).isAdmin).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, "isAdmin")).toBe(false);
    });

    it(`body: ${name}`, () => {
      const request = parse({ body: payload });

      (request as any).parsePayload();

      expect(({} as any).isAdmin).toBeUndefined();
    });
  }

  it("keeps innocent nested and indexed input", () => {
    const request = parse({ query: { "items[0][name]": "a", "user[email]": "e" } });

    (request as any).parsePayload();

    expect(request.all()).toMatchObject({ items: [{ name: "a" }], user: { email: "e" } });
  });
});

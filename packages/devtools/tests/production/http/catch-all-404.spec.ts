import type { LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { hashDashboardPath } from "../../../src/production/http/state";
import { createApp, ORIGIN, PATH, removeCatchAll, type TestApp } from "./harness";

const UNKNOWN = "/random-unknown-url";
const variants = [
  ["JSON", { accept: "application/json" }],
  ["HTML", { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" }],
] as const;

type Variant = (typeof variants)[number][1];

/** Status, headers and body with the echoed path and request id masked out. */
function shape(response: LightMyRequestResponse, path: string) {
  const {
    date: _date,
    "content-length": _length,
    "x-request-id": _id,
    ...headers
  } = response.headers;

  return {
    status: response.statusCode,
    headers,
    body: response.body
      .split(path)
      .join("<path>")
      .replace(/"requestId":"[^"]*"/g, '"requestId":"<id>"'),
  };
}

afterEach(() => removeCatchAll());

describe("closed monitor URLs on an app with a catch-all route", () => {
  const unknown = (t: TestApp, headers: Variant) =>
    t.inject({ method: "GET", url: UNKNOWN, headers });

  type Closed = (
    t: TestApp,
    headers: Variant,
  ) => Promise<{ response: LightMyRequestResponse; path: string }>;

  const via =
    (route: string, extra: Record<string, string> = {}): Closed =>
    async (t, headers) => ({
      path: `${PATH}${route}`,
      response: await t.inject({
        method: "GET",
        url: `${PATH}${route}`,
        headers: { ...headers, ...extra },
      }),
    });

  const cases: [string, Parameters<typeof createApp>[0], Closed, (t: TestApp) => Promise<void>][] =
    [
      ["no session", {}, via("/api/panels"), async () => undefined],
      ["unknown asset", {}, via("/assets/nope.js"), async () => undefined],
      ["a route the dashboard does not have", {}, via("/api/nothing-here"), async () => undefined],
      [
        "plain http with requireHttps",
        {},
        via("/api/panels", { "x-forwarded-proto": "http" }),
        async () => undefined,
      ],
      [
        "wrong host or address",
        { production: { allowedIps: ["198.51.100.0/24"] } },
        via("/"),
        async () => undefined,
      ],
      [
        "disabled",
        {},
        via("/api/panels"),
        async (t) => {
          await t.store.state.update(0, {
            disabled: true,
            disabledPathHash: hashDashboardPath(PATH),
          });
          t.state.invalidate();
        },
      ],
    ];

  describe.each(variants)("%s request", (_label, headers) => {
    it.each(cases)("answers like an unknown URL: %s", async (_name, config, call, close) => {
      const t = await createApp({ ...config, catchAll: true });

      await close(t);

      const { response, path } = await call(t, headers);
      const reference = await unknown(t, headers);

      expect(reference.statusCode).toBe(404);
      expect(reference.body).not.toContain("Not Found");
      expect(shape(response, path)).toEqual(shape(reference, UNKNOWN));
    });
  });

  it("answers a tab that is turned off like an unknown URL", async () => {
    const t = await createApp({ catchAll: true });
    const session = await t.signIn("viewer@example.com");
    const response = await t.send("GET", "/api/mails", { session });
    const reference = await unknown(t, { accept: "application/json" });

    expect(shape(response, `${PATH}/api/mails`)).toEqual(shape(reference, UNKNOWN));
  });

  it("hands the app's catch-all the request as it was sent", async () => {
    const t = await createApp({ catchAll: true });
    const response = await t.inject({ method: "GET", url: `${PATH}/api/panels` });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toMatchObject({
      code: "route_not_found",
      path: `${PATH}/api/panels`,
      method: "GET",
    });
  });

  it("applies the app's global rate limit: the same headers, one bucket, the same 429", async () => {
    const t = await createApp({ catchAll: true, rateLimit: 3 });
    const headers = { accept: "application/json" };
    const reference = await unknown(t, headers);
    const closed = await t.inject({ method: "GET", url: `${PATH}/api/panels`, headers });

    for (const name of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
      expect(reference.headers[name]).toBeDefined();
      expect(closed.headers[name]).toBeDefined();
    }

    expect(closed.headers["x-ratelimit-remaining"]).toBe("1");

    await unknown(t, headers);

    const limitedReference = await unknown(t, headers);
    const limitedClosed = await t.inject({ method: "GET", url: `${PATH}/api/panels`, headers });

    expect(limitedReference.statusCode).toBe(429);
    expect(shape(limitedClosed, `${PATH}/api/panels`)).toEqual(shape(limitedReference, UNKNOWN));
  });

  it("gives an error of the app's catch-all the app's own error answer", async () => {
    const t = await createApp({ catchAll: true });
    const headers = { accept: "application/json", "x-spec-fail": "1" };
    const reference = await unknown(t, headers);
    const closed = await t.inject({ method: "GET", url: `${PATH}/api/panels`, headers });

    expect(reference.statusCode).toBe(418);
    expect(shape(closed, `${PATH}/api/panels`)).toEqual(shape(reference, UNKNOWN));
  });

  it("answers a malformed share-link body through the catch-all, from the error handler", async () => {
    const t = await createApp({ catchAll: true, production: { share: { enabled: true } } });
    const headers = { origin: ORIGIN, "content-type": "application/json" };
    const closed = await t.inject({
      method: "POST",
      url: `${PATH}/api/share/open`,
      payload: "{not json",
      headers,
    });
    const reference = await t.inject({ method: "POST", url: UNKNOWN, payload: "{}", headers });

    expect(reference.statusCode).toBe(404);

    // Fastify closes the connection after a body it could not parse; the rest is the catch-all's answer.
    const {
      headers: { connection: _closed, ...closedHeaders },
      ...closedRest
    } = shape(closed, `${PATH}/api/share/open`);
    const {
      headers: { connection: _kept, ...referenceHeaders },
      ...referenceRest
    } = shape(reference, UNKNOWN);

    expect(closedRest).toEqual(referenceRest);
    expect(closedHeaders).toEqual(referenceHeaders);
  });
});

describe("closed monitor URLs on a plain core app", () => {
  it("answers like the app's own unknown-URL answer", async () => {
    const t = await createApp({ coreServer: true });
    const response = await t.send("GET", "/api/panels");
    const reference = await t.inject({ method: "GET", url: UNKNOWN });
    const [a, b] = [shape(response, `${PATH}/api/panels`), shape(reference, UNKNOWN)];

    expect(a.status).toBe(404);
    expect(a.headers).toEqual(b.headers);
    expect(JSON.parse(response.body).error).toBe(JSON.parse(reference.body).error);
  });
});

describe("closed monitor URLs hit with a request body", () => {
  const JSON_TYPE = { origin: ORIGIN, "content-type": "application/json" };
  const bodies: [string, string, Record<string, string>][] = [
    ["a malformed JSON body", "{not json", JSON_TYPE],
    ["an oversized body", JSON.stringify({ data: "x".repeat(1_100_000) }), JSON_TYPE],
    ["an unsupported content type", "<a/>", { origin: ORIGIN, "content-type": "application/xml" }],
    ["a valid JSON body", JSON.stringify({ a: 1 }), JSON_TYPE],
  ];

  /**
   * Fastify closes the connection after a body it could not read: that header is not part of the answer.
   * Every request here spends one of the same rate limit, so the remaining count differs by design.
   */
  function answer(response: LightMyRequestResponse, path: string) {
    const {
      headers: { connection: _connection, "x-ratelimit-remaining": _remaining, ...headers },
      ...rest
    } = shape(response, path);

    return { ...rest, headers };
  }

  describe.each([
    ["with a catch-all route", { catchAll: true, rateLimit: 100 }],
    ["without a catch-all route", {}],
  ] as const)("%s", (_label, config) => {
    it.each(bodies)(
      "answers %s like an unknown URL, to a closed route and to an unknown dashboard route",
      async (_name, payload, headers) => {
        const t = await createApp(config);
        const reference = await t.inject({ method: "POST", url: UNKNOWN, payload, headers });

        for (const route of ["/api/admin/shares", "/api/nothing-here", "/api/share/open"]) {
          const closed = await t.inject({
            method: "POST",
            url: `${PATH}${route}`,
            payload,
            headers,
          });

          expect(answer(closed, `${PATH}${route}`), route).toEqual(answer(reference, UNKNOWN));
        }
      },
    );
  });
});

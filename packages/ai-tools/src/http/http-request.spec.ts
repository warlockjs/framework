import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpPolicyError } from "../errors";
import { causeOf } from "../test-support";
import { httpRequestTool } from "./http-request";

// The default private-network deny resolves hostnames through DNS; mock
// the resolver so specs never touch the real network, with one host that
// deliberately resolves inward.
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) =>
    host === "internal.test"
      ? [{ address: "10.0.0.8", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }],
}));

/** The shape of a single recorded `fetch` invocation. */
interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  signal: AbortSignal | undefined;
}

/**
 * Install a stub `globalThis.fetch` that records every call and returns a
 * canned `Response`. Returns the recorder array plus a restore handle.
 *
 * The canned response is built from a plain init so `headers` /
 * `status` / a streamed body behave like the real `fetch` return — the
 * tool reads `response.body` as a stream, so we hand it a real `Response`
 * (Node 18+ provides the WHATWG `Response`).
 */
function stubFetch(
  responder: (call: FetchCall) => Response | Promise<Response>,
): FetchCall[] {
  const calls: FetchCall[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
      const headers: Record<string, string> = {};
      const rawHeaders = init?.headers as Record<string, string> | undefined;

      if (rawHeaders) {
        for (const key of Object.keys(rawHeaders)) {
          headers[key] = rawHeaders[key];
        }
      }

      const call: FetchCall = {
        url: input instanceof URL ? input.toString() : String(input),
        method: init?.method ?? "GET",
        headers,
        body: typeof init?.body === "string" ? init.body : undefined,
        signal: init?.signal ?? undefined,
      };
      calls.push(call);

      return responder(call);
    }),
  );

  return calls;
}

/** A JSON `Response` with a sensible default content-type. */
function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** A plain-text `Response`. */
function textResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("httpRequestTool", () => {
  it("defaults to the tool name `http_request`", () => {
    expect(httpRequestTool().name).toBe("http_request");
  });

  it("applies a custom tool name override", () => {
    expect(httpRequestTool({ name: "rest_call" }).name).toBe("rest_call");
  });

  it("resolves a present-progressive action from method + url", () => {
    const action = httpRequestTool().action;

    expect(typeof action).toBe("function");
    expect(
      typeof action === "function"
        ? action({ method: "POST", url: "https://api.test/x" })
        : action,
    ).toBe("Requesting POST https://api.test/x");
  });

  it("issues a GET by default and returns status + lower-cased headers", async () => {
    const calls = stubFetch(() =>
      new Response("ok", {
        status: 201,
        headers: { "Content-Type": "text/plain", "X-Trace": "abc" },
      }),
    );

    const { data, error } = await httpRequestTool().invoke({ url: "https://api.test/health" });

    expect(error).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(data?.status).toBe(201);
    expect(data?.headers["content-type"]).toBe("text/plain");
    expect(data?.headers["x-trace"]).toBe("abc");
    expect(data?.truncated).toBe(false);
  });

  it("rejects a method not on the allowlist, before any fetch", async () => {
    const calls = stubFetch(() => textResponse("unreachable"));

    const { data, error } = await httpRequestTool().invoke({
      method: "DELETE",
      url: "https://api.test/x",
    });

    expect(data).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(error).toBeDefined();
    expect(causeOf(error)).toBeInstanceOf(HttpPolicyError);
    expect((causeOf(error) as HttpPolicyError).type).toBe("method-not-allowed");
    expect(error?.message).toContain("DELETE");
  });

  it("allows an opted-in method", async () => {
    const calls = stubFetch(() => jsonResponse({ id: 1 }));

    const { data, error } = await httpRequestTool({ allowMethods: ["GET", "POST"] }).invoke({
      method: "POST",
      url: "https://api.test/things",
      body: { name: "widget" },
    });

    expect(error).toBeUndefined();
    expect(calls[0].method).toBe("POST");
    expect(data?.body).toEqual({ id: 1 });
  });

  it("rejects a host not on the allowlist, before any fetch", async () => {
    const calls = stubFetch(() => textResponse("unreachable"));

    const { data, error } = await httpRequestTool({ allowHosts: ["api.test"] }).invoke({
      url: "https://evil.test/steal",
    });

    expect(data).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(causeOf(error)).toBeInstanceOf(HttpPolicyError);
    expect((causeOf(error) as HttpPolicyError).type).toBe("host-not-allowed");
    expect(error?.message).toContain("evil.test");
  });

  it("permits a host that is on the allowlist", async () => {
    stubFetch(() => jsonResponse({ ok: true }));

    const { error } = await httpRequestTool({ allowHosts: ["api.test"] }).invoke({
      url: "https://api.test/ping",
    });

    expect(error).toBeUndefined();
  });

  it("joins a relative path against baseUrl", async () => {
    const calls = stubFetch(() => jsonResponse({ ok: true }));

    await httpRequestTool({ baseUrl: "https://api.test/v1/" }).invoke({ url: "users/42" });

    expect(calls[0].url).toBe("https://api.test/v1/users/42");
  });

  it("rejects an unparseable URL as a typed policy error", async () => {
    const calls = stubFetch(() => textResponse("unreachable"));

    const { error } = await httpRequestTool().invoke({ url: "not a url" });

    expect(calls).toHaveLength(0);
    expect(causeOf(error)).toBeInstanceOf(HttpPolicyError);
    expect((causeOf(error) as HttpPolicyError).type).toBe("invalid-url");
  });

  it("rejects a non-http(s) scheme", async () => {
    stubFetch(() => textResponse("unreachable"));

    const { error } = await httpRequestTool().invoke({ url: "file:///etc/passwd" });

    expect((causeOf(error) as HttpPolicyError).type).toBe("invalid-url");
  });

  it("merges static headers under per-call headers (per-call wins)", async () => {
    const calls = stubFetch(() => jsonResponse({}));

    await httpRequestTool({
      headers: { authorization: "Bearer static", "x-app": "warlock" },
    }).invoke({
      url: "https://api.test/x",
      headers: { authorization: "Bearer percall" },
    });

    expect(calls[0].headers.authorization).toBe("Bearer percall");
    expect(calls[0].headers["x-app"]).toBe("warlock");
  });

  it("serializes an object body to JSON and defaults the content-type", async () => {
    const calls = stubFetch(() => jsonResponse({ created: true }, 201));

    await httpRequestTool({ allowMethods: ["POST"] }).invoke({
      method: "POST",
      url: "https://api.test/things",
      body: { name: "widget", qty: 3 },
    });

    expect(calls[0].body).toBe(JSON.stringify({ name: "widget", qty: 3 }));
    expect(calls[0].headers["content-type"]).toBe("application/json");
  });

  it("sends a string body verbatim without overriding content-type", async () => {
    const calls = stubFetch(() => textResponse("ok"));

    await httpRequestTool({ allowMethods: ["POST"] }).invoke({
      method: "POST",
      url: "https://api.test/raw",
      body: "<xml/>",
      headers: { "content-type": "application/xml" },
    });

    expect(calls[0].body).toBe("<xml/>");
    expect(calls[0].headers["content-type"]).toBe("application/xml");
  });

  it("drops the body for a GET request", async () => {
    const calls = stubFetch(() => jsonResponse({}));

    await httpRequestTool().invoke({
      url: "https://api.test/x",
      body: { ignored: true },
    });

    expect(calls[0].body).toBeUndefined();
  });

  it("parses a JSON response body when content-type is JSON", async () => {
    stubFetch(() => jsonResponse({ user: { id: 7, name: "Ada" } }));

    const { data } = await httpRequestTool().invoke({ url: "https://api.test/user" });

    expect(data?.body).toEqual({ user: { id: 7, name: "Ada" } });
  });

  it("recognizes a +json structured-suffix content-type", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ ok: 1 }), {
          status: 200,
          headers: { "content-type": "application/vnd.api+json" },
        }),
    );

    const { data } = await httpRequestTool().invoke({ url: "https://api.test/doc" });

    expect(data?.body).toEqual({ ok: 1 });
  });

  it("returns a non-JSON body as raw text", async () => {
    stubFetch(() => textResponse("plain old text"));

    const { data } = await httpRequestTool().invoke({ url: "https://api.test/text" });

    expect(data?.body).toBe("plain old text");
  });

  it("falls back to raw text when a JSON content-type carries invalid JSON", async () => {
    stubFetch(
      () =>
        new Response("{not valid json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const { data, error } = await httpRequestTool().invoke({ url: "https://api.test/bad" });

    expect(error).toBeUndefined();
    expect(data?.body).toBe("{not valid json");
  });

  it("caps the response body at maxBytes and flags truncated", async () => {
    const big = "x".repeat(5_000);
    stubFetch(() => textResponse(big));

    const { data } = await httpRequestTool({ maxBytes: 1_000 }).invoke({
      url: "https://api.test/big",
    });

    expect(data?.truncated).toBe(true);
    expect(typeof data?.body).toBe("string");
    expect((data!.body as string).length).toBe(1_000);
  });

  it("does not truncate a body under the cap", async () => {
    stubFetch(() => textResponse("short"));

    const { data } = await httpRequestTool({ maxBytes: 1_000 }).invoke({
      url: "https://api.test/small",
    });

    expect(data?.truncated).toBe(false);
    expect(data?.body).toBe("short");
  });

  it("returns a truncated JSON body as the raw partial string, unparsed", async () => {
    const bigJson = JSON.stringify({ items: Array.from({ length: 500 }, (_, i) => i) });
    stubFetch(() => jsonResponse(JSON.parse(bigJson)));

    const { data } = await httpRequestTool({ maxBytes: 50 }).invoke({
      url: "https://api.test/list",
    });

    expect(data?.truncated).toBe(true);
    expect(typeof data?.body).toBe("string");
  });

  it("rejects a missing url as a validation error, not a throw", async () => {
    stubFetch(() => jsonResponse({}));

    const { data, error } = await httpRequestTool().invoke({});

    expect(data).toBeUndefined();
    expect(error?.name).toBe("SchemaValidationError");
  });

  it("rejects a non-string url via the schema", async () => {
    stubFetch(() => jsonResponse({}));

    const { error } = await httpRequestTool().invoke({ url: 123 });

    expect(error?.name).toBe("SchemaValidationError");
  });

  it("rejects an out-of-vocabulary method via the schema", async () => {
    stubFetch(() => jsonResponse({}));

    const { error } = await httpRequestTool().invoke({ url: "https://api.test/x", method: "HEAD" });

    expect(error?.name).toBe("SchemaValidationError");
  });

  it("aborts when the per-request timeout elapses", async () => {
    stubFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          // Never resolve on its own; reject only when the tool aborts.
          call.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const { data, error } = await httpRequestTool({ timeoutMs: 10 }).invoke({
      url: "https://api.test/slow",
    });

    expect(data).toBeUndefined();
    expect(error).toBeDefined();
    expect(error?.name).toBe("ToolExecutionError");
  });
});

describe("httpRequestTool — private-network deny (SSRF defaults)", () => {
  it("blocks metadata / loopback / private IP targets by default, before any fetch", async () => {
    const calls = stubFetch(() => textResponse("unreachable"));
    const tool = httpRequestTool();

    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:6379/",
      "https://10.1.2.3/admin",
    ]) {
      const { data, error } = await tool.invoke({ url });

      expect(data, url).toBeUndefined();
      expect(causeOf(error), url).toBeInstanceOf(HttpPolicyError);
      expect((causeOf(error) as HttpPolicyError).type, url).toBe("host-not-allowed");
    }

    expect(calls).toHaveLength(0);
  });

  it("blocks a hostname that resolves to a private address", async () => {
    const calls = stubFetch(() => textResponse("unreachable"));

    const { data, error } = await httpRequestTool().invoke({
      url: "https://internal.test/admin",
    });

    expect(data).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(causeOf(error)).toBeInstanceOf(HttpPolicyError);
    expect((causeOf(error) as HttpPolicyError).type).toBe("host-not-allowed");
  });

  it("blocks a redirect from an allowed host into the metadata endpoint", async () => {
    const calls = stubFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data/" },
        }),
    );

    const { data, error } = await httpRequestTool({ allowHosts: ["api.test"] }).invoke({
      url: "https://api.test/redirect",
    });

    expect(data).toBeUndefined();
    // The first hop is fetched; the metadata endpoint never is.
    expect(calls).toHaveLength(1);
    expect(causeOf(error)).toBeInstanceOf(HttpPolicyError);
    expect((causeOf(error) as HttpPolicyError).type).toBe("host-not-allowed");
  });

  it("permits an internal target when allowPrivateNetwork is explicitly enabled", async () => {
    const calls = stubFetch(() => jsonResponse({ ok: true }));

    const { data, error } = await httpRequestTool({ allowPrivateNetwork: true }).invoke({
      url: "http://127.0.0.1:3000/health",
    });

    expect(error).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(data?.body).toEqual({ ok: true });
  });
});

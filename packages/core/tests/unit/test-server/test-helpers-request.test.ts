import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The request layer of `@warlock.js/core/tests` — what actually goes on the wire.
 *
 * SCOPE: `fetch` is replaced, so nothing here starts a server or touches a port.
 * The subject is the RequestInit these helpers build, and only that.
 *
 * Two defects, both reported by @Fig on 2026-08-12:
 *
 *   1. `body: body ? JSON.stringify(body) : undefined` — every FALSY JSON value
 *      (`false`, `0`, `""`, `null`) is a valid payload and all four were sent as
 *      NO BODY. The check conflates "the caller omitted it" with "the caller
 *      meant this value".
 *
 *   2. Headers were merged by object spread, which is only correct for a plain
 *      record — a `Headers` instance or a tuple list silently produced garbage.
 *      And `Content-Type: application/json` was forced onto every request,
 *      including FormData bodies the helper never serialized.
 */

const fetchMock = vi.fn();

/** The RequestInit handed to `fetch` on the Nth call. */
function requestInit(callIndex = 0): RequestInit {
  return fetchMock.mock.calls[callIndex][1] as RequestInit;
}

/** Header lookup that works whatever shape the helper produced. */
function headerValue(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

describe("test request helpers — bodies", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Each of these is a legal JSON document. All four were dropped.
  it.each([
    ["false", false, "false"],
    ["zero", 0, "0"],
    ["empty string", "", '""'],
    ["null", null, "null"],
  ])("sends a falsy JSON body: %s", async (_label, body, serialized) => {
    const { testPost } = await import("../../../src/tests/test-helpers");

    await testPost("/thing", body);

    expect(requestInit().body).toBe(serialized);
  });

  it("still sends no body when the caller omits it", async () => {
    const { testPost } = await import("../../../src/tests/test-helpers");

    await testPost("/thing");

    expect(requestInit().body).toBeUndefined();
  });

  it("serializes objects and arrays unchanged", async () => {
    const { testPut } = await import("../../../src/tests/test-helpers");

    await testPut("/thing", { a: 1 });

    expect(requestInit().body).toBe('{"a":1}');
  });
});

describe("test request helpers — headers", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts headers as a plain record", async () => {
    const { testGet } = await import("../../../src/tests/test-helpers");

    await testGet("/thing", { headers: { Authorization: "Bearer x" } });

    expect(headerValue(requestInit(), "authorization")).toBe("Bearer x");
  });

  it("accepts headers as a Headers instance", async () => {
    const { testGet } = await import("../../../src/tests/test-helpers");

    await testGet("/thing", { headers: new Headers({ Authorization: "Bearer x" }) });

    expect(headerValue(requestInit(), "authorization")).toBe("Bearer x");
  });

  it("accepts headers as a tuple list", async () => {
    const { testGet } = await import("../../../src/tests/test-helpers");

    await testGet("/thing", { headers: [["Authorization", "Bearer x"]] });

    expect(headerValue(requestInit(), "authorization")).toBe("Bearer x");
  });

  it("sets the JSON content type when it serialized a JSON body", async () => {
    const { testPost } = await import("../../../src/tests/test-helpers");

    await testPost("/thing", { a: 1 });

    expect(headerValue(requestInit(), "content-type")).toBe("application/json");
  });

  it("does not override a content type the caller set", async () => {
    const { testPost } = await import("../../../src/tests/test-helpers");

    await testPost("/thing", { a: 1 }, { headers: { "Content-Type": "application/vnd.api+json" } });

    expect(headerValue(requestInit(), "content-type")).toBe("application/vnd.api+json");
  });

  it("does not set a JSON content type when there is no body to serialize", async () => {
    // Found by @Nova reviewing the first fix: the helpers passed `serializedJson:
    // true` unconditionally, so `testPost("/users")` — no body at all — still
    // announced `application/json`. The flag has to describe what actually
    // happened, not which helper was called.
    const { testPost } = await import("../../../src/tests/test-helpers");

    await testPost("/users");

    expect(headerValue(requestInit(), "content-type")).toBeNull();
  });

  it("does not force a JSON content type onto a body it did not serialize", async () => {
    // FormData must keep the multipart boundary the runtime generates. Forcing
    // application/json here produces a request no server can parse.
    const { testRequest } = await import("../../../src/tests/test-helpers");

    const form = new FormData();
    form.append("file", "contents");

    await testRequest("/upload", { method: "POST", body: form });

    expect(headerValue(requestInit(), "content-type")).not.toBe("application/json");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUrlTool } from "./fetch-url";

// The default private-network deny resolves hostnames through DNS; mock
// the resolver so specs never touch the real network, with one host that
// deliberately resolves inward.
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) =>
    host === "internal.test"
      ? [{ address: "10.0.0.8", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }],
}));

/**
 * Build a streaming `Response` stub whose `body` is a `ReadableStream`
 * emitting the given text as a single UTF-8 chunk — exercising the
 * byte-capped reader path in `readBody`. `url` defaults to the requested
 * URL the way the platform reports it after redirects.
 */
function streamResponse(text: string, init?: { status?: number; url?: string }): Response {
  const bytes = new TextEncoder().encode(text);

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  return {
    ok: true,
    status: init?.status ?? 200,
    url: init?.url ?? "https://example.com/page",
    headers: new Headers(),
    body,
    async text() {
      return text;
    },
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchUrlTool", () => {
  it("fetches and returns the raw HTML body (happy path)", async () => {
    const html = "<html><body><h1>Hello</h1></body></html>";
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(html));
    vi.stubGlobal("fetch", fetchMock);

    const tool = fetchUrlTool({ extract: "html" });
    const { data, error } = await tool.invoke({ url: "https://example.com/page" });

    expect(error).toBeUndefined();
    expect(data?.status).toBe(200);
    expect(data?.url).toBe("https://example.com/page");
    expect(data?.content).toBe(html);
    expect(data?.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a host not in allowHosts before any network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tool = fetchUrlTool({ extract: "html", allowHosts: ["docs.stripe.com"] });
    const { data, error } = await tool.invoke({ url: "https://evil.test/steal" });

    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/allowHosts allowlist/);
    expect(error?.message).toMatch(/evil\.test/);
    // SSRF guardrail: fetch is never invoked.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a host that is in allowHosts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(streamResponse("ok", { url: "https://docs.stripe.com/api" }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = fetchUrlTool({ extract: "html", allowHosts: ["docs.stripe.com"] });
    const { data, error } = await tool.invoke({ url: "https://docs.stripe.com/api" });

    expect(error).toBeUndefined();
    expect(data?.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("truncates the body at maxBytes and flags truncated", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse("abcdefghij")); // 10 bytes
    vi.stubGlobal("fetch", fetchMock);

    const tool = fetchUrlTool({ extract: "html", maxBytes: 4 });
    const { data, error } = await tool.invoke({ url: "https://example.com/page" });

    expect(error).toBeUndefined();
    expect(data?.content).toBe("abcd");
    expect(data?.truncated).toBe(true);
  });

  it("rejects a non-http(s) URL as invalid", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tool = fetchUrlTool({ extract: "html" });
    const { data, error } = await tool.invoke({ url: "file:///etc/passwd" });

    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/only supports http/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a network failure as a request-failed error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const tool = fetchUrlTool({ extract: "html" });
    const { data, error } = await tool.invoke({ url: "https://example.com/page" });

    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/request failed/);
    expect(error?.message).toMatch(/ECONNREFUSED/);
  });
});

describe("fetchUrlTool — private-network deny (SSRF defaults)", () => {
  it("blocks metadata / loopback / private IP targets by default, before any fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tool = fetchUrlTool({ extract: "html" });

    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:6379/",
      "https://10.1.2.3/admin",
    ]) {
      const { data, error } = await tool.invoke({ url });

      expect(data, url).toBeUndefined();
      expect(error?.message, url).toMatch(/blocked/);
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a hostname that resolves to a private address", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tool = fetchUrlTool({ extract: "html" });
    const { data, error } = await tool.invoke({ url: "https://internal.test/admin" });

    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/blocked/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a redirect from a public host into the metadata endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://169.254.169.254/latest/meta-data/" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = fetchUrlTool({ extract: "html" });
    const { data, error } = await tool.invoke({ url: "https://example.com/page" });

    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/blocked/);
    // The first hop is fetched; the metadata endpoint never is.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("permits an internal target when allowPrivateNetwork is explicitly enabled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(streamResponse("ok", { url: "http://127.0.0.1:3000/dev" }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = fetchUrlTool({ extract: "html", allowPrivateNetwork: true });
    const { data, error } = await tool.invoke({ url: "http://127.0.0.1:3000/dev" });

    expect(error).toBeUndefined();
    expect(data?.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

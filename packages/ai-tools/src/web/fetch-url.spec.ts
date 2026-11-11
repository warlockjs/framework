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

const ARTICLE_HTML =
  "<html><body><nav>menu</nav><article><h1>Guide</h1>" +
  `<p>${"Readable sentence about the topic. ".repeat(12)}</p>` +
  "<p>Second paragraph.</p></article></body></html>";

describe("fetchUrlTool — extractor", () => {
  it("reports the simple extractor and needs no peers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("<h1>Hi</h1><p>there</p>")));

    const tool = fetchUrlTool({ extract: "markdown", extractor: "simple" });
    const { data, error } = await tool.invoke({ url: "https://example.com/page" });

    expect(error).toBeUndefined();
    expect(data?.content).toBe("# Hi\n\nthere");
    expect(data?.extractor).toBe("simple");
  });

  it("converts to plain text with the simple extractor in text mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("<h1>Hi</h1><p>there</p>")));

    const tool = fetchUrlTool({ extract: "text", extractor: "simple" });
    const { data } = await tool.invoke({ url: "https://example.com/page" });

    expect(data?.content).toBe("Hi\n\nthere");
  });

  it("omits extractor for the raw html mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("<p>x</p>")));

    const tool = fetchUrlTool({ extract: "html" });
    const { data } = await tool.invoke({ url: "https://example.com/page" });

    expect(data && "extractor" in data).toBe(false);
  });

  it("auto uses readability when it yields enough text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(ARTICLE_HTML)));

    const tool = fetchUrlTool({ extract: "text" });
    const { data, error } = await tool.invoke({ url: "https://example.com/page" });

    expect(error).toBeUndefined();
    expect(data?.extractor).toBe("readability");
    expect(data?.content).toContain("Readable sentence");
  });

  it("auto falls back to the simple converter when the article is short", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(streamResponse("<html><body><p>Tiny page</p></body></html>")),
    );

    const tool = fetchUrlTool({ extract: "text", extractor: "auto" });
    const { data } = await tool.invoke({ url: "https://example.com/page" });

    expect(data?.extractor).toBe("simple");
    expect(data?.content).toBe("Tiny page");
  });

  it("readability extractor reports itself", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(ARTICLE_HTML)));

    const tool = fetchUrlTool({ extract: "markdown", extractor: "readability" });
    const { data } = await tool.invoke({ url: "https://example.com/page" });

    expect(data?.extractor).toBe("readability");
    expect(data?.content).toContain("# Guide");
  });
});

describe("fetchUrlTool — peers absent", () => {
  afterEach(() => {
    vi.doUnmock("@mozilla/readability");
    vi.doUnmock("jsdom");
    vi.resetModules();
  });

  async function loadWithoutPeers() {
    vi.resetModules();
    vi.doMock("@mozilla/readability", () => {
      throw new Error("Cannot find module");
    });
    vi.doMock("jsdom", () => {
      throw new Error("Cannot find module");
    });

    return import("./fetch-url");
  }

  it("auto falls back to the simple converter", async () => {
    const { fetchUrlTool: freshTool } = await loadWithoutPeers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(ARTICLE_HTML)));

    const { data, error } = await freshTool({ extract: "text" }).invoke({
      url: "https://example.com/page",
    });

    expect(error).toBeUndefined();
    expect(data?.extractor).toBe("simple");
    expect(data?.content).toContain("Readable sentence");
  });

  it("markdown fallback keeps headings, links, a table and code, without script text", async () => {
    const { fetchUrlTool: freshTool } = await loadWithoutPeers();
    const html =
      '<body><script>var secret = 1;</script><h1>Doc</h1><p>See <a href="https://a.test">docs</a></p>' +
      "<table><tr><th>K</th><th>V</th></tr><tr><td>a</td><td>1</td></tr></table>" +
      "<pre><code>run()</code></pre></body>";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(html)));

    const { data } = await freshTool({ extract: "markdown" }).invoke({
      url: "https://example.com/page",
    });

    expect(data?.content).toContain("# Doc");
    expect(data?.content).toContain("[docs](https://a.test)");
    expect(data?.content).toContain("K | V");
    expect(data?.content).toContain("```\nrun()\n```");
    expect(data?.content).not.toContain("secret");
  });

  it("readability still reports a missing-peer error", async () => {
    const { fetchUrlTool: freshTool } = await loadWithoutPeers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(ARTICLE_HTML)));

    const { data, error } = await freshTool({ extract: "text", extractor: "readability" }).invoke({
      url: "https://example.com/page",
    });

    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/@mozilla\/readability/);
  });
});

/** A challenge response: a 403 carrying the `cf-mitigated: challenge` header. */
function challengeResponse(status = 403): Response {
  const response = streamResponse("blocked", { status });

  (response as unknown as { headers: Headers }).headers = new Headers({
    "cf-mitigated": "challenge",
  });

  return response;
}

describe("fetchUrlTool — retryOnChallenge", () => {
  it("retries exactly once with an alternate User-Agent by default", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(challengeResponse())
      .mockResolvedValueOnce(streamResponse("real content"));
    vi.stubGlobal("fetch", fetchMock);

    const { data } = await fetchUrlTool({ extract: "html" }).invoke({
      url: "https://example.com/page",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(data?.status).toBe(200);
    expect(data?.content).toBe("real content");

    const firstHeaders = fetchMock.mock.calls[0]?.[1]?.headers ?? {};
    const retryHeaders = fetchMock.mock.calls[1]?.[1]?.headers ?? {};

    expect(JSON.stringify(firstHeaders)).not.toMatch(/Mozilla/);
    expect(JSON.stringify(retryHeaders)).toMatch(/Mozilla/);
  });

  it("does not retry when retryOnChallenge is false", async () => {
    const fetchMock = vi.fn().mockResolvedValue(challengeResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { data } = await fetchUrlTool({ extract: "html", retryOnChallenge: false }).invoke({
      url: "https://example.com/page",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(data?.status).toBe(403);
  });

  it("does not retry a plain 403, 429 or 503 without the challenge header", async () => {
    for (const status of [403, 429, 503]) {
      const fetchMock = vi.fn().mockResolvedValue(streamResponse("no", { status }));
      vi.stubGlobal("fetch", fetchMock);

      await fetchUrlTool({ extract: "html" }).invoke({ url: "https://example.com/page" });

      expect(fetchMock, String(status)).toHaveBeenCalledOnce();
    }
  });

  it("returns the second challenge response without a third attempt", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => challengeResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { data } = await fetchUrlTool({ extract: "html" }).invoke({
      url: "https://example.com/page",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(data?.status).toBe(403);
  });
});

describe("fetchUrlTool — UTF-8-safe truncation", () => {
  it("never splits a multi-byte character at the cap", async () => {
    // "aé" is 3 bytes; a 2-byte cap lands inside the é.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("aébc")));

    const { data } = await fetchUrlTool({ extract: "html", maxBytes: 2 }).invoke({
      url: "https://example.com/page",
    });

    expect(data?.content).toBe("a");
    expect(data?.content).not.toContain("\ufffd");
    expect(data?.truncated).toBe(true);
  });

  it("keeps a whole multi-byte character that fits exactly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse("日本語")));

    const { data } = await fetchUrlTool({ extract: "html", maxBytes: 6 }).invoke({
      url: "https://example.com/page",
    });

    expect(data?.content).toBe("日本");
  });
});

describe("fetchUrlTool — the deadline covers the body", () => {
  /** A response whose body sends one chunk and then never ends. */
  function drippingResponse(): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<p>partial"));
      },
    });

    return {
      ok: true,
      status: 200,
      url: "https://example.com/drip",
      headers: new Headers(),
      body,
    } as unknown as Response;
  }

  it("fails with a timeout error when the body never finishes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(drippingResponse()));

    const tool = fetchUrlTool({ extract: "html", timeoutMs: 50 });
    const { data, error } = await tool.invoke({ url: "https://example.com/drip" });

    expect(data).toBeUndefined();
    expect(error?.message).toMatch(/timed out after 50ms/);
    expect(error?.message).toMatch(/timeoutMs/);
  });

  it("passes the run's abort signal to the request and stops reading when it aborts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(drippingResponse());
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const tool = fetchUrlTool({ extract: "html", timeoutMs: 60_000 });
    const pending = tool.invoke(
      { url: "https://example.com/drip" },
      { artifacts: {}, signal: controller.signal },
    );
    setTimeout(() => controller.abort(new Error("run cancelled")), 20);

    const { data, error } = await pending;
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;

    expect(data).toBeUndefined();
    expect(error).toBeDefined();
    expect(init?.signal?.aborted).toBe(true);
  });
});

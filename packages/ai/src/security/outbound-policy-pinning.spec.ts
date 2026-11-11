import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutboundPolicyError } from "../errors";
import { fetchTextWithPolicy, guardedFetch, readTextCapped } from "./outbound-policy";

/**
 * DNS answers handed out in order, one per `lookup` call. The pre-check
 * and the connection each resolve the host, so a two-entry queue models a
 * rebinding name: public for the check, internal for the connection.
 */
const dnsAnswers: Array<Array<{ address: string; family: number }>> = [];

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => {
    const next = dnsAnswers.shift();

    if (!next) {
      throw new Error("unexpected DNS lookup");
    }

    return next;
  }),
}));

let server: Server | undefined;
let requestsSeen = 0;

/** Start a local HTTP server; `handler` writes each response. */
async function startServer(
  handler: Parameters<typeof createServer>[1] = (_request, response) => response.end("ok"),
): Promise<number> {
  requestsSeen = 0;
  server = createServer((request, response) => {
    requestsSeen++;
    handler?.(request, response);
  });

  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

  return (server.address() as AddressInfo).port;
}

beforeEach(() => {
  dnsAnswers.length = 0;
});

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

describe("guardedFetch — the connection uses the address that was checked", () => {
  it("refuses a host whose DNS answer turns private between the check and the connection", async () => {
    const port = await startServer();

    // Check sees a public address; the connection would see loopback.
    dnsAnswers.push(
      [{ address: "93.184.216.34", family: 4 }],
      [{ address: "127.0.0.1", family: 4 }],
    );

    await expect(
      guardedFetch(`http://rebind.example.test:${port}/latest/meta-data/`, {
        allowedSchemes: ["http"],
      }),
    ).rejects.toThrow(/127\.0\.0\.1\) when connecting/);

    // The connection was refused before any byte reached the internal server.
    expect(requestsSeen).toBe(0);
  });

  it("re-checks the connection address on a redirect hop", async () => {
    const port = await startServer();
    const realFetch = globalThis.fetch;

    // The first hop (a public IP literal) answers with a redirect to a
    // rebinding name; every other call is the real, pinned global fetch.
    const fetchSpy = vi.fn((input: unknown, init?: RequestInit) =>
      String(input).endsWith("/start")
        ? Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { location: `http://rebind.example.test:${port}/admin` },
            }),
          )
        : realFetch(input as string, init),
    );
    vi.stubGlobal("fetch", fetchSpy);

    // Redirect target: public for the check, loopback for the connection.
    dnsAnswers.push(
      [{ address: "93.184.216.34", family: 4 }],
      [{ address: "127.0.0.1", family: 4 }],
    );

    try {
      await expect(
        guardedFetch("http://93.184.216.34/start", { allowedSchemes: ["http"] }),
      ).rejects.toThrow(/when connecting/);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(requestsSeen).toBe(0);
  });
});

describe("guardedFetch — the deadline covers the body read", () => {
  it("rejects a body that keeps dripping past timeoutMs", async () => {
    const port = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.write("a");
      // Never ends: one byte now, nothing after.
    });

    const started = Date.now();

    await expect(
      fetchTextWithPolicy(`http://127.0.0.1:${port}/drip`, {
        allowedSchemes: ["http"],
        denyPrivateIPsAfterDNS: false,
        timeoutMs: 200,
      }),
    ).rejects.toBeInstanceOf(OutboundPolicyError);

    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("rejects a never-ending body from an injected fetch", async () => {
    const neverEnding = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
      },
    });
    const fetchImpl = vi.fn(async () => new Response(neverEnding));

    const response = await guardedFetch("https://8.8.8.8/x", {
      timeoutMs: 50,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await expect(readTextCapped(response, 1024)).rejects.toBeInstanceOf(OutboundPolicyError);
  });

  it("aborts the body stream for a caller that reads it directly", async () => {
    const port = await startServer((_request, response) => {
      response.writeHead(200);
      response.write("a");
    });

    const response = await guardedFetch(`http://127.0.0.1:${port}/drip`, {
      allowedSchemes: ["http"],
      denyPrivateIPsAfterDNS: false,
      timeoutMs: 200,
    });

    const reader = response.body!.getReader();
    await reader.read();

    await expect(reader.read()).rejects.toBeDefined();
  });
});

describe("guardedFetch — headers on a cross-origin redirect", () => {
  function redirectResponse(location: string): Response {
    return new Response(null, { status: 302, headers: { location } });
  }

  it("drops custom secret headers and keeps the non-credential ones", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("https://1.1.1.1/next"))
      .mockResolvedValueOnce(new Response("ok"));

    await guardedFetch(
      "https://8.8.8.8/manifest.json",
      { fetch: fetchImpl as unknown as typeof fetch },
      {
        headers: {
          "x-api-key": "secret",
          "x-auth-token": "secret",
          accept: "application/json",
          "user-agent": "warlock",
        },
      },
    );

    const second = fetchImpl.mock.calls[1]?.[1] as { headers: Record<string, string> };
    expect(second.headers["x-api-key"]).toBeUndefined();
    expect(second.headers["x-auth-token"]).toBeUndefined();
    expect(second.headers.accept).toBe("application/json");
    expect(second.headers["user-agent"]).toBe("warlock");
  });

  it("keeps a header named in crossOriginHeaders and every header on a same-origin hop", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("https://8.8.8.8/moved"))
      .mockResolvedValueOnce(redirectResponse("https://1.1.1.1/next"))
      .mockResolvedValueOnce(new Response("ok"));

    await guardedFetch(
      "https://8.8.8.8/page",
      { fetch: fetchImpl as unknown as typeof fetch, crossOriginHeaders: ["X-Request-Id"] },
      { headers: { "x-api-key": "secret", "x-request-id": "r-1" } },
    );

    const sameOrigin = fetchImpl.mock.calls[1]?.[1] as { headers: Record<string, string> };
    const crossOrigin = fetchImpl.mock.calls[2]?.[1] as { headers: Record<string, string> };
    expect(sameOrigin.headers["x-api-key"]).toBe("secret");
    expect(crossOrigin.headers["x-api-key"]).toBeUndefined();
    expect(crossOrigin.headers["x-request-id"]).toBe("r-1");
  });
});

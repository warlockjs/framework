import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetPinSkipWarnings, safeFetchToBuffer } from "./safe-fetch";
import { StorageError } from "./storage-error";

/**
 * DNS answers handed out in order, one per `lookup` call. The pre-check and
 * the connection each resolve the host, so a two-entry queue models a
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

async function startServer(): Promise<number> {
  requestsSeen = 0;
  server = createServer((_request, response) => {
    requestsSeen++;
    response.end("internal secret");
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

describe("safeFetchToBuffer connects only to the address it checked", () => {
  it("refuses a host whose DNS answer turns private after the pre-check", async () => {
    const port = await startServer();

    // The pre-check sees a public address; the connection would see loopback.
    dnsAnswers.push(
      [{ address: "93.184.216.34", family: 4 }],
      [{ address: "127.0.0.1", family: 4 }],
    );

    const download = safeFetchToBuffer(`http://rebind.example.test:${port}/latest/meta-data/`);

    await expect(download).rejects.toBeInstanceOf(StorageError);
    await expect(download).rejects.toThrow(/127\.0\.0\.1\) when connecting/);
    expect(requestsSeen).toBe(0);
  });

  it("still lets allowPrivateHosts reach an internal host on purpose", async () => {
    const port = await startServer();

    const result = await safeFetchToBuffer(`http://127.0.0.1:${port}/ok`, {
      allowPrivateHosts: true,
    });

    expect(result.buffer.toString()).toBe("internal secret");
    expect(requestsSeen).toBe(1);
  });
});

describe("safeFetchToBuffer pinning skip warning", () => {
  it("warns once when an injected fetch keeps the connection from being pinned", async () => {
    resetPinSkipWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const injected = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;

    dnsAnswers.push(
      [{ address: "93.184.216.34", family: 4 }],
      [{ address: "93.184.216.34", family: 4 }],
    );

    await safeFetchToBuffer("http://public.example.test/a", { fetch: injected });
    await safeFetchToBuffer("http://public.example.test/b", { fetch: injected });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("injected fetch");

    warn.mockRestore();
  });
});

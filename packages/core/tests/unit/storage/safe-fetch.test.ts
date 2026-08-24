import { describe, expect, it, vi } from "vitest";
import { isPrivateOrReservedIp, safeFetchToBuffer } from "../../../src/storage/utils/safe-fetch";
import { StorageError } from "../../../src/storage/utils/storage-error";

/**
 * Unit tests for the storage SSRF / resource-exhaustion guard used by
 * `putFromUrl`. The guard MIRRORS @warlock.js/ai's outbound-policy and
 * private-ip modules. We inject a fake `fetch` so no real network is touched;
 * the scheme and private-IP-literal checks fire before any fetch at all.
 *
 * Source: core/src/storage/utils/safe-fetch.ts.
 */

/** Build a Response whose body streams a single chunk of `size` bytes. */
function streamingResponse(size: number, contentType = "application/octet-stream"): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

describe("isPrivateOrReservedIp", () => {
  it("flags loopback, private, CGNAT, link-local, and metadata addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1", // CGNAT
      "169.254.0.5", // link-local
      "169.254.169.254", // cloud metadata
      "0.0.0.0",
    ]) {
      expect(isPrivateOrReservedIp(ip)).toBe(true);
    }
  });

  it("flags IPv6 loopback, unique-local, link-local, and IPv4-mapped metadata", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12::3", "fe80::1", "::ffff:169.254.169.254"]) {
      expect(isPrivateOrReservedIp(ip)).toBe(true);
    }
  });

  it("does not flag public addresses", () => {
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
    expect(isPrivateOrReservedIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("safeFetchToBuffer — SSRF guard", () => {
  it("denies a private-IP literal host before any fetch", async () => {
    const fetchSpy = vi.fn();

    await expect(
      safeFetchToBuffer("http://127.0.0.1/secret", { fetch: fetchSpy as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(StorageError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("denies the cloud-metadata endpoint", async () => {
    const fetchSpy = vi.fn();

    await expect(
      safeFetchToBuffer("http://169.254.169.254/latest/meta-data/", {
        fetch: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(StorageError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows private hosts when explicitly opted in", async () => {
    const fetchSpy = vi.fn(async () => streamingResponse(4));

    const result = await safeFetchToBuffer("http://127.0.0.1/ok", {
      allowPrivateHosts: true,
      fetch: fetchSpy as unknown as typeof fetch,
    });

    expect(result.buffer.byteLength).toBe(4);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("rejects a disallowed scheme (file://) before any fetch", async () => {
    const fetchSpy = vi.fn();

    await expect(
      safeFetchToBuffer("file:///etc/passwd", { fetch: fetchSpy as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(StorageError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects http when only https is allowed", async () => {
    const fetchSpy = vi.fn();

    await expect(
      safeFetchToBuffer("http://example.com/x", {
        allowedSchemes: ["https"],
        fetch: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(StorageError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("aborts and throws when the streamed body exceeds maxBytes", async () => {
    const fetchSpy = vi.fn(async () => streamingResponse(2_000));

    await expect(
      safeFetchToBuffer("https://example.com/big", {
        maxBytes: 1_000,
        fetch: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it("fails fast when content-length declares an oversized body", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(new Uint8Array(10), {
          status: 200,
          headers: { "content-type": "image/png", "content-length": "9999999" },
        }),
    );

    await expect(
      safeFetchToBuffer("https://example.com/declared-big", {
        maxBytes: 1_000,
        fetch: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it("returns the capped buffer and content-type on success", async () => {
    const fetchSpy = vi.fn(async () => streamingResponse(512, "image/jpeg"));

    const result = await safeFetchToBuffer("https://example.com/img.jpg", {
      fetch: fetchSpy as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(result.buffer.byteLength).toBe(512);
    expect(result.contentType).toBe("image/jpeg");
  });
});

/** Build a bare 3xx redirect Response pointing `location` at `location`. */
function redirectResponse(status: number, location: string): Response {
  return new Response(null, { status, headers: { location } });
}

// Public IP literals — same convention the file already uses for
// "does not flag public addresses" (8.8.8.8 / 1.1.1.1). IP literals skip
// DNS entirely, so these tests don't depend on real network resolution of
// made-up hostnames the way the pre-existing "example.com" tests do.
const ALLOWED_HOST_A = "8.8.8.8";
const ALLOWED_HOST_B = "1.1.1.1";

describe("safeFetchToBuffer — redirect re-validation (SSRF hop check)", () => {
  it("refuses a 302 from an allowed host to the cloud-metadata address", async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === `https://${ALLOWED_HOST_A}/redirect-me`) {
        return redirectResponse(302, "http://169.254.169.254/latest/meta-data/");
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    await expect(
      safeFetchToBuffer(`https://${ALLOWED_HOST_A}/redirect-me`, {
        fetch: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(StorageError);

    // The metadata hop must never be dispatched — the guard refuses before
    // following it, same as a direct request to that address.
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("refuses a multi-hop chain whose LAST hop is internal", async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === `https://${ALLOWED_HOST_A}/start`) {
        return redirectResponse(302, `https://${ALLOWED_HOST_A}/hop-2`);
      }
      if (url === `https://${ALLOWED_HOST_A}/hop-2`) {
        return redirectResponse(302, "http://127.0.0.1/internal");
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    await expect(
      safeFetchToBuffer(`https://${ALLOWED_HOST_A}/start`, {
        fetch: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(StorageError);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refuses once the redirect-hop bound is exceeded, even when every hop stays public", async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const match = url.match(/\/hop-(\d+)$/);
      const n = match ? Number(match[1]) : 0;
      return redirectResponse(302, `https://${ALLOWED_HOST_A}/hop-${n + 1}`);
    });

    await expect(
      safeFetchToBuffer(`https://${ALLOWED_HOST_A}/hop-0`, {
        fetch: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(StorageError);

    // DEFAULT_MAX_REDIRECTS is 5: hops 0-4 may redirect (5 fetches), the
    // 6th fetch (hop index 5) is where the bound trips before dispatch —
    // so the loop performs exactly 6 fetches total.
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  it("still follows a legitimate 302 to another allowed public host (no over-blocking)", async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === `https://${ALLOWED_HOST_A}/start`) {
        return redirectResponse(302, `https://${ALLOWED_HOST_B}/final`);
      }
      if (url === `https://${ALLOWED_HOST_B}/final`) {
        return streamingResponse(4, "image/png");
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    const result = await safeFetchToBuffer(`https://${ALLOWED_HOST_A}/start`, {
      fetch: fetchSpy as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect(result.buffer.byteLength).toBe(4);
    expect(result.contentType).toBe("image/png");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("issues every hop with redirect: \"manual\" so the platform never auto-follows", async () => {
    const fetchSpy = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return streamingResponse(1);
    });

    await safeFetchToBuffer(`https://${ALLOWED_HOST_A}/x`, {
      fetch: fetchSpy as unknown as typeof fetch,
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

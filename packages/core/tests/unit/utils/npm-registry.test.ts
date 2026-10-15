import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLatestVersion } from "../../../src/utils/npm-registry";

/**
 * Every one of these is an "offline-ish" failure the dev server can hit in
 * the wild. The contract is the same for all of them: resolve `undefined`,
 * never reject — that is what keeps `warlock dev` alive without a network.
 */
describe("fetchLatestVersion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns the latest version on a healthy response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "4.9.0" }),
      })),
    );

    await expect(fetchLatestVersion("@warlock.js/core")).resolves.toBe("4.9.0");
  });

  it("resolves undefined when the network is down (DNS/connect failure)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("getaddrinfo ENOTFOUND registry.npmjs.org"), {
            code: "ENOTFOUND",
          }),
        });
      }),
    );

    await expect(fetchLatestVersion("@warlock.js/core")).resolves.toBeUndefined();
  });

  it("resolves undefined when the request is aborted by the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
          });
        });
      }),
    );

    await expect(fetchLatestVersion("@warlock.js/core", 5)).resolves.toBeUndefined();
  });

  it("resolves undefined on a non-200 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));

    await expect(fetchLatestVersion("@warlock.js/core")).resolves.toBeUndefined();
  });

  it("resolves undefined when the payload is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      })),
    );

    await expect(fetchLatestVersion("@warlock.js/core")).resolves.toBeUndefined();
  });

  it("resolves undefined when the payload has no usable version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ version: 42 }) })),
    );

    await expect(fetchLatestVersion("@warlock.js/core")).resolves.toBeUndefined();
  });

  it("clears its abort timer so a finished lookup never holds the process open", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await fetchLatestVersion("@warlock.js/core");

    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });
});

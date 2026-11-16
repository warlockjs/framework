import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardedFetch, resetPinSkipWarnings } from "./outbound-policy";

const KEY = Symbol.for("undici.globalDispatcher.1");
const holder = globalThis as unknown as Record<symbol, unknown>;
const optionsSymbol = Symbol("options");

/** A stand-in for undici's `Agent`: keeps its options under a symbol named "options". */
class Agent {
  public readonly [optionsSymbol]: { connect?: unknown };

  public constructor(public readonly given: { connect?: unknown }) {
    this[optionsSymbol] = given;
  }
}

class ProxyAgent {}

let original: unknown;
let warn: ReturnType<typeof vi.spyOn>;
let dispatchers: unknown[];

/** Replace the global `fetch` with a spy that records the dispatcher it was handed. */
function stubFetch(): void {
  dispatchers = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { dispatcher?: unknown }) => {
      dispatchers.push(init?.dispatcher);

      return new Response("ok");
    }),
  );
}

beforeEach(() => {
  original = holder[KEY];
  resetPinSkipWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  stubFetch();
});

afterEach(() => {
  holder[KEY] = original;
  warn.mockRestore();
  vi.unstubAllGlobals();
});

describe("guardedFetch — pinned dispatcher", () => {
  it("keeps the connect options of the installed Agent and adds the pinned lookup", async () => {
    holder[KEY] = new Agent({ connect: { ca: "private-ca", timeout: 5000 } });

    await guardedFetch("https://8.8.8.8/x", {});

    const pinnedAgent = dispatchers[0] as Agent;
    const connect = pinnedAgent.given.connect as Record<string, unknown>;

    expect(connect.ca).toBe("private-ca");
    expect(connect.timeout).toBe(5000);
    expect(typeof connect.lookup).toBe("function");
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once and skips pinning for a proxy dispatcher", async () => {
    holder[KEY] = new ProxyAgent();

    await guardedFetch("https://8.8.8.8/x", {});
    await guardedFetch("https://8.8.8.8/y", {});

    expect(dispatchers).toEqual([undefined, undefined]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/ProxyAgent/);
  });

  it("warns and skips pinning when the Agent connect option is a function", async () => {
    holder[KEY] = new Agent({ connect: () => undefined });

    await guardedFetch("https://8.8.8.8/x", {});

    expect(dispatchers[0]).toBeUndefined();
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/custom connect function/);
  });

  it("warns once and skips pinning for an injected fetch", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));

    await guardedFetch("https://8.8.8.8/x", { fetch: fetchImpl as unknown as typeof fetch });
    await guardedFetch("https://8.8.8.8/x", { fetch: fetchImpl as unknown as typeof fetch });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/injected fetch/);
  });

  it("does not warn when the private-IP check is off", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));

    await guardedFetch("https://8.8.8.8/x", {
      denyPrivateIPsAfterDNS: false,
      fetch: fetchImpl as unknown as typeof fetch,
    });

    expect(warn).not.toHaveBeenCalled();
  });
});

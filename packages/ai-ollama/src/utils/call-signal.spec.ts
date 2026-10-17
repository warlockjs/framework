import { describe, expect, it } from "vitest";
import { signalAwareFetch, withCallSignal } from "./call-signal";

function recordingFetch() {
  const seen: Array<AbortSignal | null | undefined> = [];
  const base = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init?.signal);

    return new Response("{}");
  }) as typeof fetch;

  return { base, seen };
}

describe("signalAwareFetch", () => {
  it("passes requests through untouched outside a call", async () => {
    const { base, seen } = recordingFetch();

    await signalAwareFetch(base)("http://127.0.0.1/api/chat");

    expect(seen).toEqual([undefined]);
  });

  it("hands the current call's signal to fetch", async () => {
    const { base, seen } = recordingFetch();
    const controller = new AbortController();

    await withCallSignal(controller.signal, () => signalAwareFetch(base)("http://127.0.0.1/"));

    expect(seen[0]).toBe(controller.signal);
  });

  it("combines the call's signal with the client's own", async () => {
    const { base, seen } = recordingFetch();
    const call = new AbortController();
    const own = new AbortController();

    await withCallSignal(call.signal, () =>
      signalAwareFetch(base)("http://127.0.0.1/", { signal: own.signal }),
    );

    const combined = seen[0];

    expect(combined?.aborted).toBe(false);
    call.abort();
    expect(combined?.aborted).toBe(true);
  });
});

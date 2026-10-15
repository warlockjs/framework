import { afterEach, describe, expect, it, vi } from "vitest";
import { Image } from "./image";

const okResponse = (body: BodyInit = "img", headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers });

describe("Image.fromUrl (SSRF guard)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([
    "http://127.0.0.1/a.png",
    "http://169.254.169.254/latest/meta-data",
    "http://[::ffff:7f00:1]/a.png",
  ])("refuses %s without issuing a request", async (url) => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(Image.fromUrl(url)).rejects.toThrow(/blocked/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a redirect to a metadata address", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(Image.fromUrl("http://93.184.216.34/a.png")).rejects.toThrow(/blocked/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("enforces the body size cap (declared content-length)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse("x", { "content-length": String(60 * 1024 * 1024) }),
      ),
    );

    await expect(Image.fromUrl("http://93.184.216.34/big.png")).rejects.toThrow(/too large/);
  });

  it("enforces the body size cap on a streamed body without content-length", async () => {
    const chunk = new Uint8Array(10 * 1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ >= 7) return controller.close();
        controller.enqueue(chunk);
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));

    await expect(Image.fromUrl("http://93.184.216.34/big.png")).rejects.toThrow(/exceeded/);
  });

  it("enforces the timeout by aborting the request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );

    const promise = Image.fromUrl("http://93.184.216.34/slow.png");
    const assertion = expect(promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(30_001);
    await assertion;
  });
});

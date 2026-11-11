import { afterEach, describe, expect, it } from "vitest";
import { setConfig } from "../../../../config/config-setter";
import type { DoctorBootContext } from "../check.types";
import { trustProxyCheck } from "./trust-proxy.check";

const bootContext = {} as DoctorBootContext;

async function run() {
  return await trustProxyCheck.run(bootContext);
}

afterEach(() => {
  setConfig("http", undefined as unknown as never);
});

describe("doctor trust-proxy check", () => {
  it("is ok for a list of trusted proxies", async () => {
    setConfig("http", { trustProxy: ["10.0.0.0/8"] } as never);

    expect((await run())?.status).toBe("ok");
  });

  it("is ok for trustProxy: true with a realIpHeader", async () => {
    setConfig("http", { trustProxy: true, realIpHeader: "cf-connecting-ip" } as never);

    const result = await run();

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain("cf-connecting-ip");
  });

  it("warns for trustProxy: true without a realIpHeader, naming both settings", async () => {
    setConfig("http", { trustProxy: true } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("http.trustProxy");
    expect(result?.detail).toContain("http.realIpHeader");
  });

  it("is ok for a predicate function", async () => {
    setConfig("http", { trustProxy: () => true } as never);

    expect((await run())?.detail).toContain("function");
  });

  it("is silent on a shape the server refuses at start", async () => {
    setConfig("http", { trustProxy: 2 } as never);
    expect(await run()).toBeUndefined();

    setConfig("http", { trustProxy: [] } as never);
    expect(await run()).toBeUndefined();
  });

  it("is silent when no proxy is trusted or the setting is absent", async () => {
    setConfig("http", { trustProxy: false } as never);
    expect(await run()).toBeUndefined();

    setConfig("http", { port: 3000 } as never);
    expect(await run()).toBeUndefined();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { setConfig } from "../../../../config/config-setter";
import type { DoctorBootContext } from "../check.types";
import { compressionCheck } from "./compression.check";

const bootContext = {} as DoctorBootContext;

async function run() {
  return await compressionCheck.run(bootContext);
}

afterEach(() => {
  setConfig("http", undefined as unknown as never);
});

describe("doctor compression check", () => {
  it("is ok when compression is on", async () => {
    setConfig("http", { compression: { threshold: 2048 } } as never);

    const result = await run();

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain("compressed");
    expect(result?.code).toBeUndefined();
  });

  it("never warns when compression is off: it notes the setting and the proxy case", async () => {
    setConfig("http", { compression: false } as never);

    const result = await run();

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain("http.compression: true");
    expect(result?.detail).toContain("proxy or CDN");
    expect(result?.code).toBe("WL1020");
  });

  it("treats an absent setting as off", async () => {
    setConfig("http", { port: 3000 } as never);

    const result = await run();

    expect(result?.detail).toContain("off");
    expect(result?.code).toBe("WL1020");
  });

  it("is silent when there is no http config", async () => {
    expect(await run()).toBeUndefined();
  });
});

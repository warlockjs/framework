import { afterEach, describe, expect, it } from "vitest";
import { setConfig } from "../../../../config/config-setter";
import type { DoctorBootContext } from "../check.types";
import { corsCheck } from "./cors.check";

const bootContext = {} as DoctorBootContext;

async function run() {
  return await corsCheck.run(bootContext);
}

afterEach(() => {
  setConfig("http", undefined as unknown as never);
});

describe("doctor cors check", () => {
  it("is ok for a list of origins", async () => {
    setConfig("http", { cors: { origin: ["https://app.example.com"] } } as never);

    const result = await run();

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain("1 listed origin");
  });

  it("is ok for an empty list (same origin only)", async () => {
    setConfig("http", { cors: { origin: [] } } as never);

    expect((await run())?.status).toBe("ok");
  });

  it('warns on origin "*", naming http.cors.origin', async () => {
    setConfig("http", { cors: { origin: "*" } } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain('http.cors.origin is "*"');
  });

  it('warns on "*" inside a list', async () => {
    setConfig("http", { cors: { origin: ["https://app.example.com", "*"] } } as never);

    expect((await run())?.status).toBe("warn");
  });

  it('warns on "*" with credentials', async () => {
    setConfig("http", { cors: { origin: "*", credentials: true } } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("credentials: true");
  });

  it("warns when every origin is echoed back with credentials", async () => {
    setConfig("http", { cors: { origin: true, credentials: true } } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("signed-in requests");
  });

  it('reports the framework default "*" when http.cors.origin is absent', async () => {
    setConfig("http", { port: 3000 } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("http.cors.origin is not set");
  });

  it("warns when origin is present but empty, as an unset env var leaves it", async () => {
    setConfig("http", { cors: { origin: undefined } } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("Invalid CORS origin option");
    expect(result?.detail).not.toContain("default");
  });

  it("warns instead of failing when reading the config throws", async () => {
    setConfig("http", {
      get cors() {
        throw new Error("boom");
      },
    } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("boom");
  });

  it("is silent when there is no http config", async () => {
    expect(await run()).toBeUndefined();
  });
});

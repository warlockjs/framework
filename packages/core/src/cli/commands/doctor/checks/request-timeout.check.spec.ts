import { afterEach, describe, expect, it } from "vitest";
import { setConfig } from "../../../../config/config-setter";
import type { DoctorBootContext } from "../check.types";
import { requestTimeoutCheck } from "./request-timeout.check";

const bootContext = {} as DoctorBootContext;

async function run() {
  return await requestTimeoutCheck.run(bootContext);
}

afterEach(() => {
  setConfig("http", undefined as unknown as never);
});

describe("doctor request-timeout check", () => {
  it("is ok for a positive timeout", async () => {
    setConfig("http", { requestTimeout: 60_000 } as never);

    expect((await run())?.status).toBe("ok");
  });

  it("warns when http.requestTimeout is 0", async () => {
    setConfig("http", { requestTimeout: 0 } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("http.requestTimeout is 0");
  });

  it("reads serverOptions.requestTimeout first, as the server does", async () => {
    setConfig("http", { requestTimeout: 60_000, serverOptions: { requestTimeout: 0 } } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("http.serverOptions.requestTimeout is 0");
  });

  it("is silent when the setting is absent (the 5-minute default applies)", async () => {
    setConfig("http", { port: 3000 } as never);

    expect(await run()).toBeUndefined();
  });
});

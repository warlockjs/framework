import { ConsoleLog } from "@warlock.js/logger";
import { afterEach, describe, expect, it } from "vitest";
import { setConfig } from "../../../../config/config-setter";
import type { DoctorBootContext } from "../check.types";
import { productionLoggingCheck } from "./production-logging.check";

const bootContext = {} as DoctorBootContext;

async function run() {
  return await productionLoggingCheck.run(bootContext);
}

afterEach(() => {
  setConfig("log", undefined as unknown as never);
});

describe("doctor production-logging check", () => {
  it('is ok when the production console channel has minLevel "info"', async () => {
    setConfig("log", {
      production: { channels: [new ConsoleLog({ minLevel: "info" })] },
    } as never);

    expect((await run())?.status).toBe("ok");
  });

  it("is ok when the channel's levels leave debug out", async () => {
    setConfig("log", {
      production: { channels: [new ConsoleLog({ levels: ["info", "warn", "error"] })] },
    } as never);

    expect((await run())?.status).toBe("ok");
  });

  it("warns when the production console channel prints debug lines, naming minLevel", async () => {
    setConfig("log", { production: { channels: [new ConsoleLog()] } } as never);

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain("log.production.channels");
    expect(result?.detail).toContain('minLevel: "info"');
  });

  it("counts a console channel shared by every environment", async () => {
    setConfig("log", { channels: [new ConsoleLog()] } as never);

    expect((await run())?.detail).toContain("log.channels");
  });

  it("is silent when production logging is disabled", async () => {
    setConfig("log", { production: { enabled: false, channels: [new ConsoleLog()] } } as never);

    expect(await run()).toBeUndefined();
  });

  it("is silent when no console channel is used in production", async () => {
    setConfig("log", { development: { channels: [new ConsoleLog()] } } as never);

    expect(await run()).toBeUndefined();
  });

  it("is silent when there is no log config", async () => {
    expect(await run()).toBeUndefined();
  });
});

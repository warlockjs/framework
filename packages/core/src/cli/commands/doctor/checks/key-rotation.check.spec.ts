import { afterEach, describe, expect, it } from "vitest";
import { setConfig } from "../../../../config/config-setter";
import type { DoctorBootContext } from "../check.types";
import { keyRotationCheck } from "./key-rotation.check";

const bootContext = {} as DoctorBootContext;

afterEach(() => {
  setConfig("encryption", undefined as unknown as never);
  setConfig("auth", undefined as unknown as never);
});

describe("doctor key-rotation check", () => {
  it("is silent when no retired key is configured", async () => {
    setConfig("encryption", { key: "a" } as never);

    expect(await keyRotationCheck.run(bootContext)).toBeUndefined();
  });

  it("is silent for empty lists", async () => {
    setConfig("encryption", { previousKeys: [] } as never);
    setConfig("auth", { accessToken: { previousSecrets: [""] } } as never);

    expect(await keyRotationCheck.run(bootContext)).toBeUndefined();
  });

  it("warns and names each configured setting", async () => {
    setConfig("encryption", { previousKeys: ["k1", "k2"] } as never);
    setConfig("auth", { refreshToken: { previousSecrets: ["s"] } } as never);

    const result = await keyRotationCheck.run(bootContext);

    expect(result?.status).toBe("warn");
    expect(result?.code).toBe("WL1019");
    expect(result?.detail).toContain("encryption.previousKeys (2)");
    expect(result?.detail).toContain("auth.refreshToken.previousSecrets (1)");
    expect(result?.detail).not.toContain("accessToken");
  });
});

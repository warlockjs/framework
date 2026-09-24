import { afterEach, describe, expect, it } from "vitest";
import { resetMailConfig, resolveMailConfig, setMailConfigurations } from "./config";

describe("mail config secure default", () => {
  afterEach(() => resetMailConfig());

  it("defaults secure to false for port 587 (Gmail preset)", () => {
    setMailConfigurations({ host: "smtp.gmail.com", port: 587 } as any);

    expect((resolveMailConfig({}) as any).secure).toBe(false);
  });

  it("defaults secure to true for port 465", () => {
    setMailConfigurations({ host: "smtp.gmail.com", port: 465 } as any);

    expect((resolveMailConfig({}) as any).secure).toBe(true);
  });

  it("lets an explicit secure value win", () => {
    setMailConfigurations({ host: "h", port: 587, secure: true } as any);
    expect((resolveMailConfig({}) as any).secure).toBe(true);

    expect((resolveMailConfig({ config: { host: "h", port: 465, secure: false } as any }) as any).secure).toBe(false);
  });
});

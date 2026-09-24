import { afterEach, describe, expect, it } from "vitest";
import { getMailMode, resetMailConfig, resolveMailConfig, setMailConfigurations, setMailMode } from "./config";

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

describe("mail mode default", () => {
  const original = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = original;
    resetMailConfig();
  });

  it("defaults to development mode under test/development (no real sends)", () => {
    process.env.NODE_ENV = "test";
    expect(getMailMode()).toBe("development");
  });

  it("defaults to production in production and lets setMailMode override", () => {
    process.env.NODE_ENV = "production";
    expect(getMailMode()).toBe("production");

    setMailMode("test");
    expect(getMailMode()).toBe("test");
  });
});

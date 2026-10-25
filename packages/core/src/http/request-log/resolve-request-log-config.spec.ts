import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import {
  getRequestLogConfig,
  isRequestLogEnabled,
  resetRequestLogConfigForTests,
  resolveRequestLogConfig,
} from "./resolve-request-log-config";

afterEach(() => {
  config.set("http.logging", undefined);
  resetRequestLogConfigForTests();
});

describe("resolveRequestLogConfig", () => {
  it("is on, logs everything and records bodies in development", () => {
    const resolved = resolveRequestLogConfig(undefined, "development");

    expect(resolved).toMatchObject({
      enabled: true,
      only: "all",
      slowMs: 1000,
      sampleRate: 1,
      maxBodyBytes: 16 * 1024,
      strictHeaders: false,
      retention: { maxDays: 14, maxSizeMb: 256 },
    });
    expect(resolved.include).toMatchObject({
      headers: true,
      body: true,
      response: true,
      logs: true,
    });
  });

  it("is off outside development, and logs only errors with no bodies once enabled", () => {
    expect(resolveRequestLogConfig(undefined, "production").enabled).toBe(false);
    expect(resolveRequestLogConfig(undefined, "test").enabled).toBe(false);

    const production = resolveRequestLogConfig({ enabled: true }, "production");

    expect(production.only).toBe("errors");
    expect(production.strictHeaders).toBe(true);
    expect(production.include).toMatchObject({ body: false, response: false, headers: true });
  });

  it("lets the app override every default", () => {
    const resolved = resolveRequestLogConfig(
      {
        enabled: false,
        only: "slow",
        slowMs: 250,
        sampleRate: 0.25,
        maxBodyBytes: 100,
        include: { body: true, response: true, phases: false },
        retention: { maxDays: 3, maxSizeMb: 10 },
      },
      "development",
    );

    expect(resolved).toMatchObject({
      enabled: false,
      only: "slow",
      slowMs: 250,
      sampleRate: 0.25,
      maxBodyBytes: 100,
      retention: { maxDays: 3, maxSizeMb: 10 },
    });
    expect(resolved.include.phases).toBe(false);
    expect(
      resolveRequestLogConfig({ enabled: true, include: { body: true } }, "production").include
        .body,
    ).toBe(true);
  });

  it("clamps the sample rate and ignores nonsense limits", () => {
    expect(resolveRequestLogConfig({ sampleRate: 4 }, "development").sampleRate).toBe(1);
    expect(resolveRequestLogConfig({ sampleRate: -1 }, "development").sampleRate).toBe(0);
    expect(resolveRequestLogConfig({ maxBodyBytes: 0, slowMs: -5 }, "development")).toMatchObject({
      maxBodyBytes: 16 * 1024,
      slowMs: 1000,
    });
  });
});

describe("getRequestLogConfig", () => {
  it("reads http.logging.requests once and caches it", () => {
    config.set("http.logging", { requests: { enabled: true, only: "slow" } });

    expect(isRequestLogEnabled()).toBe(true);

    config.set("http.logging", { requests: { enabled: false } });

    expect(getRequestLogConfig().only).toBe("slow");
    expect(isRequestLogEnabled()).toBe(true);
  });

  it("is disabled under the test environment by default", () => {
    expect(isRequestLogEnabled()).toBe(false);
  });
});

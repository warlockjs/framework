import { describe, expect, it } from "vitest";
import { buildPostgresPoolConfig } from "./postgres-driver";

const base = { database: "app" };

describe("postgres session time zone", () => {
  it("pins the session to UTC by default", () => {
    expect(buildPostgresPoolConfig(base).options).toBe("-c TimeZone=UTC");
  });

  it("uses the timezone option", () => {
    expect(buildPostgresPoolConfig({ ...base, timezone: "Africa/Cairo" }).options).toBe(
      "-c TimeZone=Africa/Cairo",
    );
  });

  it("leaves the server zone alone when timezone is false", () => {
    expect(buildPostgresPoolConfig({ ...base, timezone: false }).options).toBeUndefined();
  });

  it("keeps the app's other options and appends the zone", () => {
    expect(buildPostgresPoolConfig({ ...base, options: "-c statement_timeout=5000" }).options).toBe(
      "-c statement_timeout=5000 -c TimeZone=UTC",
    );
  });

  it("lets an app-supplied TimeZone in options win", () => {
    expect(buildPostgresPoolConfig({ ...base, options: "-c TimeZone=Asia/Riyadh" }).options).toBe(
      "-c TimeZone=Asia/Riyadh",
    );
  });

  it("lets a TimeZone in the connection string win", () => {
    const config = buildPostgresPoolConfig({
      ...base,
      connectionString: "postgres://u:p@h/app?options=-c%20TimeZone%3DAsia%2FRiyadh",
    });

    expect(config.options).toBeUndefined();
  });
});

describe("buildPostgresPoolConfig forwards pg options", () => {
  it("passes through pg pool and client options cascade does not list", () => {
    const types = { getTypeParser: () => String };
    const config = buildPostgresPoolConfig({
      database: "app",
      statement_timeout: 5000,
      query_timeout: 7000,
      lock_timeout: 1000,
      idle_in_transaction_session_timeout: 2000,
      keepAliveInitialDelayMillis: 3000,
      allowExitOnIdle: true,
      client_encoding: "UTF8",
      types,
    } as any) as Record<string, unknown>;

    expect(config.statement_timeout).toBe(5000);
    expect(config.query_timeout).toBe(7000);
    expect(config.lock_timeout).toBe(1000);
    expect(config.idle_in_transaction_session_timeout).toBe(2000);
    expect(config.keepAliveInitialDelayMillis).toBe(3000);
    expect(config.allowExitOnIdle).toBe(true);
    expect(config.client_encoding).toBe("UTF8");
    expect(config.types).toBe(types);
  });

  it("keeps cascade-only keys out of the pool config and still applies defaults", () => {
    const config = buildPostgresPoolConfig({
      database: "app",
      naming: "snake_case",
      nativeArrayColumns: ["tags"],
      logging: true,
      timezone: "UTC",
    }) as Record<string, unknown>;

    for (const key of ["naming", "nativeArrayColumns", "logging", "timezone"]) {
      expect(key in config).toBe(false);
    }
    expect(config.max).toBe(10);
    expect(config.connectionTimeoutMillis).toBe(10000);
    expect(config.application_name).toBe("cascade");
  });
});

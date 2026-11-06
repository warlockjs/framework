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

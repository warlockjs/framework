import { describe, expect, it } from "vitest";
import { buildPostgresPoolConfig } from "../../../src/drivers/postgres/postgres-driver";
import type { PostgresPoolConfig } from "../../../src/drivers/postgres/types";

/**
 * `env()` (@mongez/dotenv) coerces a numeric-looking value to a number, so a
 * `DB_NAME` / `DB_USERNAME` / `DB_PASSWORD` like "12345" reaches the driver as
 * a number. pg's connection fields must be strings — a number crashes it with
 * an inscrutable Buffer error (finding 51639bf8). `buildPostgresPoolConfig`
 * coerces the string-typed fields back to strings.
 */
describe("buildPostgresPoolConfig — coerces env-numified fields (51639bf8)", () => {
  it("stringifies a numeric database, user and password", () => {
    const config = buildPostgresPoolConfig({
      database: 12345,
      user: 42,
      password: 999,
    } as unknown as PostgresPoolConfig);

    expect(config.database).toBe("12345");
    expect(config.user).toBe("42");
    expect(config.password).toBe("999");
    expect(typeof config.database).toBe("string");
  });

  it("passes string connection fields through unchanged", () => {
    const config = buildPostgresPoolConfig({
      host: "db.local",
      port: 5433,
      database: "warlock",
      user: "postgres",
      password: "secret",
    } as PostgresPoolConfig);

    expect(config.host).toBe("db.local");
    expect(config.port).toBe(5433);
    expect(config.database).toBe("warlock");
    expect(config.user).toBe("postgres");
  });

  it("leaves undefined fields undefined and defaults host/port", () => {
    const config = buildPostgresPoolConfig({} as PostgresPoolConfig);

    expect(config.database).toBeUndefined();
    expect(config.user).toBeUndefined();
    expect(config.host).toBe("localhost");
    expect(config.port).toBe(5432);
  });
});

/**
 * Card ba1193b4: under load (soak at concurrency 10), the blog hit
 * "timeout exceeded when trying to connect" and "Connection terminated
 * unexpectedly". The blog's database config sets no pool tuning at all, so
 * these defaults ARE what production runs on.
 */
describe("buildPostgresPoolConfig — resilience defaults (ba1193b4)", () => {
  it("defaults connectionTimeoutMillis to 10000ms, not the too-tight 2000ms", () => {
    const config = buildPostgresPoolConfig({ database: "warlock" } as PostgresPoolConfig);

    expect(config.connectionTimeoutMillis).toBe(10000);
  });

  it("defaults keepAlive to true so idle sockets survive NAT/OS pruning", () => {
    const config = buildPostgresPoolConfig({ database: "warlock" } as PostgresPoolConfig);

    expect(config.keepAlive).toBe(true);
  });

  it("defaults idleTimeoutMillis to 30000ms", () => {
    const config = buildPostgresPoolConfig({ database: "warlock" } as PostgresPoolConfig);

    expect(config.idleTimeoutMillis).toBe(30000);
  });

  it("lets the app override connectionTimeoutMillis and keepAlive", () => {
    const config = buildPostgresPoolConfig({
      database: "warlock",
      connectionTimeoutMillis: 5000,
      keepAlive: false,
    } as PostgresPoolConfig);

    expect(config.connectionTimeoutMillis).toBe(5000);
    expect(config.keepAlive).toBe(false);
  });

  it("keeps max configurable with a documented default of 10", () => {
    const defaulted = buildPostgresPoolConfig({ database: "warlock" } as PostgresPoolConfig);
    const overridden = buildPostgresPoolConfig({
      database: "warlock",
      max: 25,
    } as PostgresPoolConfig);

    expect(defaulted.max).toBe(10);
    expect(overridden.max).toBe(25);
  });
});

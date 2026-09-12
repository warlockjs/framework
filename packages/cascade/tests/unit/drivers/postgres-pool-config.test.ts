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

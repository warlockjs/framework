import { scheduler } from "@warlock.js/scheduler";
import { describe, expect, it, vi } from "vitest";
import { PostgresDialect } from "./postgres-dialect";
import {
  loadPostgresTTLPurgeJobs,
  purgeExpiredPostgresRows,
  postgresTTLPurgeComment,
  postgresTTLPurgeJobName,
  registerPostgresTTLPurgeJob,
  unregisterAllPostgresTTLPurgeJobs,
  unregisterPostgresTTLPurgeJob,
} from "./postgres-ttl-purge";

describe("PostgreSQL TTL purge jobs", () => {
  it("registers a job which deletes expired rows with quoted identifiers and a bound TTL interval", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const driver = { dialect: new PostgresDialect(), query };
    const table = "audit events";
    const column = "expires at";

    registerPostgresTTLPurgeJob(driver, table, column, 3600);
    const name = postgresTTLPurgeJobName(driver, table, column);
    const scheduledJob = scheduler.getJob(name);

    expect(scheduledJob).toBeDefined();
    await scheduledJob?.run();

    expect(query).toHaveBeenCalledWith(
      `DELETE FROM "audit events" WHERE "expires at" < NOW() - ($1 * INTERVAL '1 second') AND ctid IN ` +
        `(SELECT ctid FROM "audit events" WHERE "expires at" < NOW() - ($1 * INTERVAL '1 second') LIMIT $2)`,
      [3600, 5000],
    );

    unregisterPostgresTTLPurgeJob(driver, table, column);
    expect(scheduler.getJob(name)).toBeUndefined();
  });

  it("restores a persisted index retention rule after a new driver connects", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ description: postgresTTLPurgeComment("events", "expires_at", 900) }],
    });
    const driver = { dialect: new PostgresDialect(), query };

    await loadPostgresTTLPurgeJobs(driver);
    const name = postgresTTLPurgeJobName(driver, "events", "expires_at");
    expect(scheduler.getJob(name)).toBeDefined();
    expect(query.mock.calls[0]?.[0]).toContain("pg_catalog.pg_description");

    unregisterAllPostgresTTLPurgeJobs(driver);
    expect(scheduler.getJob(name)).toBeUndefined();
  });

  it("deletes a backlog in batches until a short batch", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 5000 })
      .mockResolvedValueOnce({ rowCount: 5000 })
      .mockResolvedValueOnce({ rowCount: 12 });
    const driver = { dialect: new PostgresDialect(), query };

    await purgeExpiredPostgresRows(driver, "sessions", "expires_at", 60);

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.every(([sql]) => String(sql).includes("LIMIT $2"))).toBe(true);
  });

  it("stops after 100 batches in one run", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 5000 });
    const driver = { dialect: new PostgresDialect(), query };

    await purgeExpiredPostgresRows(driver, "sessions", "expires_at", 60);

    expect(query).toHaveBeenCalledTimes(100);
  });

  it("skips a run while the previous one is still deleting", async () => {
    let release: (value: unknown) => void = () => undefined;
    const query = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const driver = { dialect: new PostgresDialect(), query };

    registerPostgresTTLPurgeJob(driver, "sessions", "expires_at", 60);
    const scheduledJob = scheduler.getJob(
      postgresTTLPurgeJobName(driver, "sessions", "expires_at"),
    );

    const first = scheduledJob?.run();
    await Promise.resolve();
    await scheduledJob?.run();

    expect(query).toHaveBeenCalledTimes(1);

    release({ rowCount: 0 });
    await first;
    unregisterAllPostgresTTLPurgeJobs(driver);
  });
});

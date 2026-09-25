import { scheduler } from "@warlock.js/scheduler";
import { describe, expect, it, vi } from "vitest";
import { PostgresDialect } from "./postgres-dialect";
import {
  loadPostgresTTLPurgeJobs,
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
      `DELETE FROM "audit events" WHERE "expires at" < NOW() - ($1 * INTERVAL '1 second')`,
      [3600],
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
});

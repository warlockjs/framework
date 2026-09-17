import { describe, expect, it } from "vitest";
import { insertQueueDashboardBlock } from "./insert-queue-dashboard-block";

const queueConfigStub = [
  'import { env } from "@warlock.js/core";',
  'import type { QueueConfig } from "@warlock.js/queue";',
  "",
  "const queueConfig: QueueConfig = {",
  "  connection: {",
  '    host: env("REDIS_HOST", "127.0.0.1"),',
  '    port: env("REDIS_PORT", 6379),',
  "  },",
  "  defaultJobOptions: {",
  "    attempts: 3,",
  '    backoff: { type: "exponential", delay: 1000 },',
  "  },",
  "  workers: {",
  "    enabled: true,",
  "    concurrency: 5,",
  "    shutdownTimeout: 30_000,",
  "  },",
  "};",
  "",
  "export default queueConfig;",
  "",
].join("\n");

describe("insertQueueDashboardBlock", () => {
  it("adds the dashboard block before the closing brace, past the nested objects", () => {
    const result = insertQueueDashboardBlock(queueConfigStub);

    expect(result.status).toBe("added");
    expect(result).toMatchObject({
      next: expect.stringContaining(
        '  dashboard: { enabled: true, path: "/admin/queues", middleware: [] },\n};',
      ),
    });
  });

  it("is idempotent when a dashboard property already exists", () => {
    const withDashboard = queueConfigStub.replace(
      "};",
      '  dashboard: { enabled: true, path: "/admin/queues", middleware: [] },\n};',
    );

    const result = insertQueueDashboardBlock(withDashboard);

    expect(result).toEqual({ status: "already-present" });
  });

  it("reports unrecognised when there is no queueConfig object to insert into", () => {
    const result = insertQueueDashboardBlock("export default {};\n");

    expect(result).toEqual({ status: "unrecognised" });
  });
});

import { describe, expect, it } from "vitest";
import { defineJob, queueOf, registeredJobs } from "../src";

/**
 * The registry readers are public so tools (`warlock inspect`) can list the
 * jobs an app defined without dispatching anything. No Redis is touched:
 * `defineJob` only registers, and `queueOf` only reads the definition.
 */
describe("registered job readers", () => {
  it("lists every defined job and the queue it runs on", () => {
    const job = defineJob({
      name: "registry-exports.send-report",
      queue: "reports",
      attempts: 3,
      handle: () => undefined,
    });

    const registered = registeredJobs().find((entry) => entry.name === job.name);

    expect(registered).toMatchObject({ name: "registry-exports.send-report", attempts: 3 });
    expect(registered ? queueOf(registered) : undefined).toBe("reports");
  });
});

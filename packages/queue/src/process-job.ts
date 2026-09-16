import { type Job, UnrecoverableError } from "bullmq";
import { findRegisteredJob } from "./job-registry";
import type { JobContext } from "./types";

/**
 * The single BullMQ processor every worker runs: route the job to the
 * handler registered under its name.
 *
 * A name with no handler in this process fails with `UnrecoverableError` —
 * retrying cannot make a missing definition appear, so it must not burn
 * through its attempts.
 */
export async function processJob(job: Job): Promise<unknown> {
  const definition = findRegisteredJob(job.name);

  if (!definition) {
    throw new UnrecoverableError(
      `No job named "${job.name}" is defined in this process. ` +
        "Make sure the module that calls defineJob() is imported by the worker process.",
    );
  }

  const context: JobContext = {
    id: String(job.id),
    name: job.name,
    queue: job.queueName,
    attempt: job.attemptsMade + 1,
    maxAttempts: job.opts.attempts ?? 1,
    progress: (value) => job.updateProgress(value),
    log: async (line) => {
      await job.log(line);
    },
  };

  return definition.handle(job.data, context);
}

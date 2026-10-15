import { unwrapPayload } from "./queue-context";
import type { Job } from "bullmq";
import { defaultQueueName } from "./config";
import { FailedJobNotFoundError } from "./errors";
import { getQueue } from "./queue-manager";
import type { FailedJob } from "./types";

export type FailedJobsOptions = {
  /** Queue to read. Default: the default queue. */
  queue?: string;
  /** First index (newest first). Default `0`. */
  start?: number;
  /** Last index, inclusive. Default `99`. */
  end?: number;
};

/**
 * List failed jobs, newest first — jobs that used up every attempt, or
 * failed unrecoverably. Each entry can be retried.
 */
export async function failedJobs(options: FailedJobsOptions = {}): Promise<FailedJob[]> {
  const queueName = options.queue ?? defaultQueueName();
  const jobs = await getQueue(queueName).getFailed(options.start ?? 0, options.end ?? 99);

  return jobs.map((job) => toFailedJob(job));
}

/**
 * Retry one failed job by id: it goes back to waiting with its attempts reset.
 * Throws {@link FailedJobNotFoundError} when no FAILED job has that id.
 */
export async function retryFailedJob(id: string, options: { queue?: string } = {}): Promise<void> {
  const queueName = options.queue ?? defaultQueueName();
  const job = await getQueue(queueName).getJob(id);

  if (!job || !(await job.isFailed())) {
    throw new FailedJobNotFoundError(id, queueName);
  }

  await job.retry("failed");
}

function toFailedJob(job: Job): FailedJob {
  return {
    id: String(job.id),
    name: job.name,
    queue: job.queueName,
    payload: unwrapPayload(job.data).payload,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
    stacktrace: job.stacktrace ?? [],
    failedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
    retry: () => job.retry("failed"),
  };
}

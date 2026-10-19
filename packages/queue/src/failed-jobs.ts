import { defaultQueueName } from "./config";
import { getQueueDriver } from "./queue-driver";
import type { FailedJob } from "./types";

export type FailedJobsOptions = {
  /** Queue to read. Default: the default queue. */
  queue?: string;
  /** First index (newest first). Default `0`. */
  start?: number;
  /** Last index, inclusive. Default `99`. */
  end?: number;
};

/** List failed jobs, newest first, using the selected driver. */
export async function failedJobs(options: FailedJobsOptions = {}): Promise<FailedJob[]> {
  return getQueueDriver().failed(
    options.queue ?? defaultQueueName(),
    options.start ?? 0,
    options.end ?? 99,
  );
}

/** Move a failed job back to waiting, resetting its attempts. */
export async function retryFailedJob(id: string, options: { queue?: string } = {}): Promise<void> {
  await getQueueDriver().retry(options.queue ?? defaultQueueName(), id);
}

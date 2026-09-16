/**
 * BullMQ-backed `QueueDispatcher` for `@warlock.js/notifications`.
 *
 * Notifications renders the payload and resolves the route BEFORE handing a
 * job to its dispatcher, so the job (`{ channel, route, payload, options }`)
 * is plain JSON. This adapter enqueues it as a queue job; the job's handler,
 * running in any worker process, looks the channel up by name in that
 * process's notifications config and calls `channel.send`.
 *
 * Notifications itself has no dependency on this package.
 */
import { getNotificationConfig, type QueueDispatcher } from "@warlock.js/notifications";
import { UnrecoverableError } from "bullmq";
import { defineJob } from "../define-job";
import { toMilliseconds } from "../duration";
import type { Duration, JobBackoff, QueueJob } from "../types";

/** The job name notification deliveries run under. */
export const NOTIFICATION_JOB_NAME = "warlock.notifications.deliver";

export type NotificationJobPayload = Parameters<QueueDispatcher["dispatch"]>[0];

export type QueueNotificationDispatcherOptions = {
  /** Queue to deliver on. Default: the default queue. */
  queue?: string;
  /** Attempts per delivery. Default: `queue.defaultJobOptions.attempts`, else `1`. */
  attempts?: number;
  /** Backoff between attempts. */
  backoff?: JobBackoff;
};

/**
 * Create the dispatcher for `NotificationConfig.queue`.
 *
 * - `SendOptions.delay` is honoured: a number is SECONDS (notifications'
 *   convention), a string is a duration such as `"10m"`.
 * - A failing `channel.send` throws, so the delivery is retried per
 *   `attempts` / `backoff` and ends in `failedJobs()` when exhausted.
 * - A channel missing from the worker's notifications config fails at once,
 *   without retries.
 *
 * @example src/config/notifications.ts
 * import { queueNotificationDispatcher } from "@warlock.js/queue/notifications";
 *
 * const config: NotificationConfig = {
 *   channels: { mail: mailChannel() },
 *   queue: queueNotificationDispatcher({ attempts: 3, backoff: { type: "exponential", delay: 5000 } }),
 * };
 */
export function queueNotificationDispatcher(
  options: QueueNotificationDispatcherOptions = {},
): QueueDispatcher {
  const deliver = defineNotificationJob(options);

  return {
    async dispatch(job) {
      await deliver.dispatch(job, {
        delay: job.options.delay === undefined ? undefined : notificationDelay(job.options.delay),
      });
    },
  };
}

function defineNotificationJob(
  options: QueueNotificationDispatcherOptions,
): QueueJob<NotificationJobPayload, void> {
  return defineJob<NotificationJobPayload, void>({
    name: NOTIFICATION_JOB_NAME,
    queue: options.queue,
    attempts: options.attempts,
    backoff: options.backoff,
    async handle(job) {
      const channels = getNotificationConfig().channels as Record<
        string,
        { send(context: never): Promise<void> } | undefined
      >;
      const channel = channels[job.channel];

      if (!channel) {
        throw new UnrecoverableError(
          `Notification channel "${job.channel}" is not configured in this worker's notifications config.`,
        );
      }

      await channel.send({ payload: job.payload, route: job.route, options: job.options } as never);
    },
  });
}

function notificationDelay(delay: number | string): Duration {
  return typeof delay === "number" ? delay * 1_000 : toMilliseconds(delay);
}

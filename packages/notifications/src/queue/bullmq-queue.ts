/**
 * BullMQ-backed `QueueDispatcher` — an alternative to `heraldQueue()` for apps
 * that already run `@warlock.js/queue` and would rather deliver notifications
 * through it than stand up a herald broker.
 *
 * `defineNotification` renders the payload + resolves the route BEFORE
 * handing a job to the dispatcher, so the job (`{ channel, route, payload,
 * options }`) is plain JSON — the same contract `heraldQueue` relies on.
 *
 * `@warlock.js/queue` is an OPTIONAL peer, lazy-loaded via `loadQueuePackage`
 * on first `.dispatch()` — never at import time — so notifications never pays
 * for `@warlock.js/queue` unless `bullmqQueue()` is actually configured.
 *
 * @example  src/config/notifications.ts — declarative; the connector registers it
 *   import { type NotificationConfig, bullmqQueue, mailChannel } from "@warlock.js/notifications";
 *
 *   const config: NotificationConfig = {
 *     channels: { mail: mailChannel() },
 *     queue: bullmqQueue({ attempts: 3, backoff: { type: "exponential", delay: 5000 } }),
 *   };
 *
 *   export default config;
 */
import type { JobBackoff } from "@warlock.js/queue";
import type { QueueDispatcher } from "../contracts";
import { getNotificationConfig } from "../config";
import type { ChannelName, SendOptions } from "../types";
import { loadQueuePackage } from "./load-queue";

/** The job name notification deliveries run under. */
export const NOTIFICATION_JOB_NAME = "warlock.notifications.deliver";

export type BullmqQueueOptions = {
  /** Queue to deliver on. Default: `@warlock.js/queue`'s default queue. */
  queue?: string;
  /** Attempts per delivery. Default: `queue.defaultJobOptions.attempts`, else `1`. */
  attempts?: number;
  /** Backoff between attempts. */
  backoff?: JobBackoff;
};

type NotificationJobPayload = {
  channel: string;
  route: unknown;
  payload: unknown;
  options: SendOptions;
};

/**
 * Create the `QueueDispatcher` for `NotificationConfig.queue` backed by
 * `@warlock.js/queue`.
 *
 * - `SendOptions.delay` is honoured: a number is SECONDS (notifications'
 *   convention), a string is a duration such as `"10m"` (`@warlock.js/queue`'s
 *   convention).
 * - A channel missing from the worker's notifications config throws — the
 *   delivery is retried per `attempts` / `backoff` like any other failure.
 */
export function bullmqQueue(options: BullmqQueueOptions): QueueDispatcher {
  let jobPromise: ReturnType<typeof defineNotificationJob> | undefined;

  return {
    async dispatch(job) {
      if (!jobPromise) {
        jobPromise = defineNotificationJob(options);
      }

      const notificationJob = await jobPromise;

      await notificationJob.dispatch(
        { channel: job.channel, route: job.route, payload: job.payload, options: job.options },
        {
          delay: job.options.delay === undefined ? undefined : notificationDelay(job.options.delay),
        },
      );
    },
  };
}

async function defineNotificationJob(options: BullmqQueueOptions) {
  const { defineJob } = await loadQueuePackage();

  return defineJob<NotificationJobPayload, void>({
    name: NOTIFICATION_JOB_NAME,
    queue: options.queue,
    attempts: options.attempts,
    backoff: options.backoff,
    async handle(job) {
      const channel = getNotificationConfig().channels[job.channel as ChannelName];

      if (!channel) {
        throw new Error(
          `Notification channel "${job.channel}" is not configured in this worker's notifications config.`,
        );
      }

      await channel.send({ payload: job.payload, route: job.route, options: job.options } as never);
    },
  });
}

function notificationDelay(delay: number | string): number {
  return typeof delay === "number" ? delay * 1_000 : toMilliseconds(delay);
}

// `toMilliseconds` mirrors `@warlock.js/queue`'s duration parser but is
// inlined here so this file doesn't need a non-lazy import from the optional
// peer just to convert a string like "10m".
function toMilliseconds(value: string): number {
  const units: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(value.trim());

  if (!match) {
    throw new Error(
      `Invalid duration "${value}": expected a number of milliseconds or a string like ` +
        `"500ms", "30s", "10m", "2h", "1d".`,
    );
  }

  return Math.round(Number(match[1]) * units[match[2]!]!);
}

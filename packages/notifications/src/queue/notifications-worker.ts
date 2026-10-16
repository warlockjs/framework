/**
 * Notification queue worker — consumes the jobs `heraldQueue` publishes and
 * runs the actual `channel.send`. Call this once in a worker process (or the
 * web process) after the notifications config + herald broker are up.
 *
 * The job carries an ALREADY-RENDERED payload + resolved route, so the worker
 * only looks the channel up by name and dispatches — no notifiable needed.
 *
 * @example
 *   // in a worker entrypoint, after the notifications config + broker are up
 *   import { startNotificationsWorker } from "@warlock.js/notifications";
 *   await startNotificationsWorker();
 */
import { log } from "@warlock.js/logger";
import { getNotificationConfig } from "../config";
import type { ChannelName, SendOptions } from "../types";
import { DEFAULT_QUEUE_CHANNEL, loadHerald } from "./load-herald";

type NotificationJob = {
  channel: string;
  route: unknown;
  payload: unknown;
  options: SendOptions;
};

export type WorkerOptions = {
  /** Herald channel to consume from. Must match the dispatcher. Default `"notifications.dispatch"`. */
  channel?: string;
  /** Herald broker name. Default broker if omitted. */
  broker?: string;
};

export async function startNotificationsWorker(options: WorkerOptions = {}): Promise<void> {
  const channelName = options.channel ?? DEFAULT_QUEUE_CHANNEL;
  const { herald } = await loadHerald();

  await herald(options.broker)
    .channel(channelName)
    .subscribe(async (message: { payload: unknown }, ctx: { ack(): Promise<void> }) => {
      const job = message.payload as NotificationJob;

      try {
        const channel = getNotificationConfig().channels[job.channel as ChannelName];

        if (!channel) {
          // Unknown channel — log and ack to avoid a poison-message loop.
          log.error(
            "notifications",
            "queue.worker",
            `Unknown channel "${job.channel}" — dropping job`,
          );
          await ctx.ack();
          return;
        }

        await channel.send({
          payload: job.payload as never,
          route: job.route as never,
          options: job.options,
        });

        await ctx.ack();
      } catch (error) {
        // Phase 2: log + ack (no retry/DLQ yet — that lands with the
        // delay-aware worker). A dead-letter strategy is a follow-up.
        log.error("notifications", "queue.worker", error as Error);
        await ctx.ack();
      }
    });
}

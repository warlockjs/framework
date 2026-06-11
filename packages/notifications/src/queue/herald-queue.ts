/**
 * Herald-backed `QueueDispatcher` — the production backend for `.queue()`.
 *
 * `defineNotification` renders payloads + resolves routes BEFORE handing a job
 * to the dispatcher, so the job is fully serializable (`{ channel, route,
 * payload, options }`) — no model re-hydration or closure serialization. This
 * dispatcher just publishes the job onto a herald channel; the worker
 * (`startNotificationsWorker`) consumes it and runs `channel.send`.
 *
 * Connection is the app's job — the `@warlock.js/herald` connector connects the
 * broker from `config/herald.ts` at boot; this dispatcher only calls `herald()`.
 *
 * @example
 *   import { setNotificationConfig, heraldQueue, inApp, mailChannel } from "@warlock.js/notifications";
 *
 *   setNotificationConfig({
 *     channels: { mail: mailChannel(), database: inApp.configure({ model: Notification }) },
 *     queue: heraldQueue(),                 // → `.queue()` now works
 *   });
 */
import type { QueueDispatcher } from "../contracts";
import { DEFAULT_QUEUE_CHANNEL, loadHerald } from "./load-herald";

export type HeraldQueueOptions = {
  /** Herald channel to publish jobs to. Default `"notifications.dispatch"`. */
  channel?: string;
  /** Herald broker name (multi-broker setups). Default broker if omitted. */
  broker?: string;
};

export function heraldQueue(options: HeraldQueueOptions = {}): QueueDispatcher {
  const channelName = options.channel ?? DEFAULT_QUEUE_CHANNEL;

  return {
    async dispatch(job) {
      const { herald } = await loadHerald();
      await herald(options.broker).channel(channelName).publish(job);
    },
  };
}

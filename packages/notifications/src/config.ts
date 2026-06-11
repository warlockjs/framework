/**
 * Notification configuration holder. The runtime singleton the dispatch core
 * reads from. Called once at boot (typically by the notifications connector
 * or `config/notifications.ts`).
 *
 * @example
 *   import { setNotificationConfig, mailChannel, inApp } from "@warlock.js/notifications";
 *   import { Notification } from "app/notifications/notification.model";
 *
 *   setNotificationConfig({
 *     channels: {
 *       mail: mailChannel({ from: "no-reply@store.com" }),
 *       database: inApp.configure({ model: Notification }),
 *     },
 *     // preferences / rateLimit / queue all optional
 *   });
 */
import type {
  Channel,
  PreferenceProvider,
  QueueDispatcher,
  RateLimiter,
} from "./contracts";
import { NotificationsNotConfiguredError } from "./errors";
import type { ChannelName, NotificationChannels } from "./types";

/**
 * Channel registry — each key is a registered channel name, each value the
 * channel whose payload type matches the registry. Typed as a partial map
 * over `ChannelName` so `setNotificationConfig` rejects a channel whose
 * payload doesn't line up with its registry entry, AND so a custom channel
 * (declaration-merged into `NotificationChannels`) is accepted with its real
 * payload type rather than `any`.
 */
export type ChannelMap = Partial<{
  [C in ChannelName]: Channel<NotificationChannels[C]>;
}>;

/**
 * Runtime configuration the dispatcher reads on every send. `queue`,
 * `preferences`, and `rateLimit` are all OPTIONAL slots — the package
 * reserves their shape but ships no defaults.
 */
export type NotificationConfig = {
  /** Channel registry — keys correlate to `NotificationChannels` payloads. */
  channels: ChannelMap;
  /** Async dispatcher backing `.queue()`. Phase 2 ships a herald impl. */
  queue?: QueueDispatcher;
  /** Pre-send gate: drops channels the recipient opted out of. */
  preferences?: PreferenceProvider;
  /** Pre-send gate: drops channels exceeding per-recipient budgets. */
  rateLimit?: RateLimiter;
};

let activeConfig: NotificationConfig | undefined;

/**
 * Set the active notifications configuration. Called once at boot.
 * Subsequent calls REPLACE the active config (does not merge) — pass the
 * complete config, not a partial.
 */
export function setNotificationConfig(config: NotificationConfig): void {
  activeConfig = config;
}

/**
 * Get the active notifications configuration. Throws if not yet configured —
 * fail loudly at the first send rather than silently doing nothing.
 */
export function getNotificationConfig(): NotificationConfig {
  if (!activeConfig) {
    throw new NotificationsNotConfiguredError();
  }
  return activeConfig;
}

/**
 * Clear the active configuration. Intended for tests; not part of the runtime
 * surface. Production code should never call this.
 */
export function resetNotificationConfig(): void {
  activeConfig = undefined;
}

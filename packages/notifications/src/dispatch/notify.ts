/**
 * `notify` — ad-hoc, per-channel send facade.
 *
 * A Proxy keyed by the channel registry. `notify.<channel>(to, payload,
 * options?)` works for ANY channel name registered in
 * `NotificationChannels` — built-in or custom (via declaration merging).
 *
 * For multi-channel sends, use `defineNotification` — that's the reusable
 * pattern and the only mental model for "send through several channels at
 * once" (no inline multi-channel overload here on purpose).
 *
 * `notify.channel(name)` is the runtime escape when the channel name isn't a
 * compile-time literal.
 *
 * @example
 *   await notify.mail(user, { subject: "Welcome", html: "<p>Hi!</p>" });
 *   await notify.database(user, { type: "welcome", title: "Welcome!" });
 *   await notify.mail("guest@example.com", { subject: "…", html: "…" });   // raw target
 *   await notify.channel(dynamicName).send(user, payload);                 // dynamic name
 */
import { getNotificationConfig } from "../config";
import type { ChannelName, Notifiable, NotificationChannels, SendOptions } from "../types";
import { newDispatchId } from "./dispatch-id";
import { dispatchChannel } from "./dispatcher";
import { emit } from "./notifications-event-bus";

/**
 * Public shape of `notify`. The mapped portion gives `notify.<channel>` per
 * registered channel; `channel(name)` is the runtime escape.
 */
export type Notify = {
  channel(name: string): {
    send(to: Notifiable | string, payload: unknown, options?: SendOptions): Promise<void>;
  };
} & {
  [C in ChannelName]: (
    to: Notifiable | string,
    payload: NotificationChannels[C],
    options?: SendOptions,
  ) => Promise<void>;
};

/**
 * Per-call dispatch for `notify.<channel>`. Mirrors `defineNotification`'s
 * pipeline but without rendering: payload is already concrete.
 *
 * Preferences gate runs ONLY when a notification `type` is known — explicit
 * via `options.type`, or implicit from a database payload's `type` field.
 * Without a type we have nothing to gate on, and ad-hoc sends bypass
 * preferences silently (use `defineNotification` if you want guaranteed
 * gating).
 */
async function notifyImpl(
  channelName: string,
  to: Notifiable | string,
  payload: unknown,
  options: SendOptions = {},
): Promise<void> {
  const isRawTarget = typeof to === "string";
  const notifiable: Notifiable | undefined = isRawTarget ? undefined : to;

  // Derive the type: explicit `options.type` wins, then the payload's
  // `type` field (database channel convention).
  let notificationType: string | undefined = options.type;
  if (
    notificationType === undefined &&
    payload &&
    typeof payload === "object" &&
    "type" in payload &&
    typeof (payload as { type: unknown }).type === "string"
  ) {
    notificationType = (payload as { type: string }).type;
  }

  // Preferences gate — only when notifiable + type are both available.
  if (notifiable && notificationType && !options.force) {
    const config = getNotificationConfig();

    if (config.preferences) {
      const allowed = await config.preferences.resolveChannels(notifiable, notificationType, [
        channelName as ChannelName,
      ]);

      if (!allowed.includes(channelName as ChannelName)) {
        await emit("skipped", {
          dispatchId: newDispatchId(),
          channel: channelName,
          notifiable,
          reason: "preference",
          options,
        });
        return;
      }
    }
  }

  await dispatchChannel({
    channelName,
    payload,
    to: notifiable,
    rawRoute: isRawTarget ? to : undefined,
    notificationType,
    mode: "send",
    options,
  });
}

/**
 * Build the `notify` proxy. `channel(name)` returns a `{ send }` object;
 * any other property access returns a one-shot dispatcher for that channel.
 */
export const notify: Notify = new Proxy({} as Notify, {
  get(_target, prop) {
    if (typeof prop === "symbol") {
      return undefined;
    }

    // Don't masquerade as a thenable — awaiting or Promise-wrapping `notify`
    // must NOT invoke notify.then(...) as a channel send. Also keep common
    // serialization probes from being treated as channel names.
    if (prop === "then" || prop === "catch" || prop === "finally" || prop === "toJSON") {
      return undefined;
    }

    if (prop === "channel") {
      return (name: string) => ({
        send: (to: Notifiable | string, payload: unknown, options?: SendOptions) =>
          notifyImpl(name, to, payload, options),
      });
    }

    return (to: Notifiable | string, payload: unknown, options?: SendOptions) =>
      notifyImpl(prop, to, payload, options);
  },
});

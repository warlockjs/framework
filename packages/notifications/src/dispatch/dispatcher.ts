/**
 * Internal dispatch core — shared by `defineNotification` and `notify.<channel>`.
 *
 * Responsibilities:
 * 1. Look up the channel in the configured registry (throws if missing).
 * 2. Run the rate-limit gate (if a notification type is known) — drop with a
 *    `skipped` event when the limiter refuses.
 * 3. Resolve the route: raw string > channel.route(notifiable) > { id }.
 * 4. Inject the per-send `idempotencyKey` into the database payload.
 * 5. Dispatch (sync via channel.send OR async via queue.dispatch).
 * 6. Emit `sent` on success, `failed` on throw.
 *
 * Per-channel failure isolation is the CALLER's job (it wraps a list of
 * `dispatchChannel` calls in `Promise.allSettled`).
 */
import { getNotificationConfig } from "../config";
import { ChannelNotFoundError, NoQueueDispatcherError, UnresolvableRouteError } from "../errors";
import type { ChannelName, Id, Notifiable, SendOptions } from "../types";
import { emit } from "./notifications-event-bus";

export type DispatchMode = "send" | "queue";

export type DispatchChannelArgs = {
  channelName: string;
  payload: unknown;
  /** The recipient model — undefined when dispatching to a raw route string. */
  to: Notifiable | undefined;
  /** Raw route override (ad-hoc `notify.mail("x@y.com", …)`). */
  rawRoute?: string;
  /** Notification type — drives the rate-limit gate. May be undefined. */
  notificationType: string | undefined;
  mode: DispatchMode;
  options: SendOptions;
};

/**
 * Dispatch ONE rendered payload to ONE recipient through ONE channel.
 * Does NOT consult `PreferenceProvider` — that gate runs at the caller level.
 *
 * Throws `ChannelNotFoundError` (channel not registered) and
 * `UnresolvableRouteError` (channel's `route()` returned undefined) — both are
 * configuration/data errors that should surface loudly. Transport failures
 * (channel.send throwing) are emitted as `failed` AND rethrown.
 */
export async function dispatchChannel(args: DispatchChannelArgs): Promise<void> {
  const config = getNotificationConfig();
  const channel = config.channels[args.channelName as ChannelName];

  if (!channel) {
    throw new ChannelNotFoundError(args.channelName);
  }

  // Rate-limit gate. Only applies when we have a notifiable + a notification
  // type (otherwise there's nothing to rate-limit on). `force` does NOT
  // bypass — rate limits are a safety valve, not a UX preference.
  //
  // NOTE (Phase-2 seam): for mode "queue" the budget is consumed at ENQUEUE
  // time here, not at delivery. When the herald worker lands it should run
  // this gate at delivery instead; see RateLimiter docstring.
  if (args.to && args.notificationType && config.rateLimit) {
    const allowed = await config.rateLimit.allow(
      args.to,
      args.channelName as ChannelName,
      args.notificationType,
    );

    if (!allowed) {
      await emit("skipped", {
        channel: args.channelName,
        notifiable: args.to,
        reason: "rate-limit",
        options: args.options,
      });
      return;
    }
  }

  const route = resolveRoute(args, channel.route);

  // Inject idempotency key into the database payload (so the repo can dedupe).
  let payload = args.payload;
  if (
    args.channelName === "database" &&
    args.options.idempotencyKey &&
    payload &&
    typeof payload === "object"
  ) {
    payload = { ...(payload as object), idempotencyKey: args.options.idempotencyKey };
  }

  try {
    if (args.mode === "queue") {
      if (!config.queue) {
        throw new NoQueueDispatcherError(args.channelName);
      }
      await config.queue.dispatch({
        channel: args.channelName,
        route,
        payload,
        options: args.options,
      });
    } else {
      await channel.send({
        payload: payload as never,
        route,
        notifiable: args.to,
        options: args.options,
      });
    }

    await emit("sent", {
      channel: args.channelName,
      notifiable: args.to,
      payload,
      options: args.options,
    });
  } catch (error) {
    await emit("failed", {
      channel: args.channelName,
      notifiable: args.to,
      payload,
      error: error as Error,
      options: args.options,
    });
    throw error;
  }
}

/**
 * Route resolution priority:
 *   1. raw route string (ad-hoc `notify.mail("x@y.com", …)`)
 *   2. the channel's `route(notifiable)` resolver
 *   3. `{ id: notifiable.id }` — ONLY when the channel declares no resolver
 *
 * When a channel HAS a resolver but it returns undefined (e.g. a mail
 * recipient with no email), we throw `UnresolvableRouteError` rather than
 * silently coercing to `{ id }` — that would hand a string-route channel an
 * object and fail deep inside the transport.
 */
function resolveRoute(
  args: DispatchChannelArgs,
  resolver: ((notifiable: Notifiable) => string | { id: Id } | undefined) | undefined,
): string | { id: Id } {
  if (args.rawRoute !== undefined) {
    return args.rawRoute;
  }

  if (!args.to) {
    throw new UnresolvableRouteError(args.channelName);
  }

  // No resolver declared → the channel addresses by id (database/internal).
  if (!resolver) {
    return { id: args.to.id };
  }

  const resolved = resolver(args.to);

  if (resolved === undefined) {
    throw new UnresolvableRouteError(args.channelName, args.to.id);
  }

  return resolved;
}

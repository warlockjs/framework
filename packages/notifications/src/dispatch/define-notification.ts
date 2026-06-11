/**
 * `defineNotification` — reusable, type-safe, multi-channel notification.
 *
 * Functional, not class-based: pass `via` + a renderer per channel + a
 * stable `type`. The returned object exposes `.send` / `.queue` / `.only`.
 *
 * Renderer signature is `(data, to, ctx)` where `ctx` carries `locale` and
 * `meta` from `SendOptions`. The database renderer's `type` is OPTIONAL — the
 * dispatcher injects `def.type`, keeping the type defined in ONE place.
 *
 * ## Error policy
 * - **Config errors** (missing renderer, no queue dispatcher, unknown channel)
 *   are programmer mistakes → they REJECT `.send()`/`.queue()` (and a static
 *   `via` with a missing renderer throws at definition time). Consistent with
 *   `notify`, which rejects `ChannelNotFoundError`.
 * - **Transport errors** (a channel's `send` throwing) stay ISOLATED — emitted
 *   as a `failed` event, never aborting sibling channels/recipients.
 * - **`via()` / preferences throws** for one recipient are logged and that
 *   recipient is dropped (the rest of a fan-out still go).
 *
 * @example
 *   export const orderShipped = defineNotification<{ order: Order }>({
 *     type: "order.shipped",
 *     via: ["mail", "database"],
 *     mail: ({ order }, to) => ({ subject: `#${order.number} shipped`, html: "…" }),
 *     database: ({ order }) => ({ title: "Your order shipped", payload: { id: order.id } }),
 *   });
 *   await orderShipped.send(user, { order });
 *   await orderShipped.queue([buyer, salesRep], { order }, { delay: "10m" });
 *   await orderShipped.only("mail").send(user, { order });
 */
import { log } from "@warlock.js/logger";
import { getNotificationConfig } from "../config";
import {
  ChannelNotFoundError,
  MissingRendererError,
  NoQueueDispatcherError,
} from "../errors";
import type {
  ChannelName,
  Notifiable,
  NotificationChannels,
  RenderContext,
  SendOptions,
} from "../types";
import { dispatchChannel, type DispatchMode } from "./dispatcher";
import { emit } from "./notifications-event-bus";

/**
 * Per-channel renderer return type. The `database` renderer may OMIT `type`
 * — it inherits from `NotificationDef.type` at dispatch time.
 */
type RendererReturn<C extends ChannelName> = C extends "database"
  ? Omit<NotificationChannels["database"], "type">
  : NotificationChannels[C];

type Renderer<Data, C extends ChannelName> = (
  data: Data,
  to: Notifiable,
  ctx: RenderContext,
) => RendererReturn<C>;

export type NotificationDef<Data> = {
  type: string;
  via: ChannelName[] | ((data: Data, to: Notifiable) => ChannelName[]);
} & {
  [C in ChannelName]?: Renderer<Data, C>;
};

export interface DefinedNotification<Data> {
  send(to: Notifiable | Notifiable[], data: Data, options?: SendOptions): Promise<void>;
  queue(to: Notifiable | Notifiable[], data: Data, options?: SendOptions): Promise<void>;
  only(...channels: ChannelName[]): DefinedNotification<Data>;
}

/** Errors that represent a misconfiguration and must surface (reject), not isolate. */
function isConfigError(error: unknown): boolean {
  return (
    error instanceof MissingRendererError ||
    error instanceof NoQueueDispatcherError ||
    error instanceof ChannelNotFoundError
  );
}

export function defineNotification<Data>(def: NotificationDef<Data>): DefinedNotification<Data> {
  const make = (restrict?: ChannelName[]): DefinedNotification<Data> => {
    // Validate at definition time when the channel set is static — a missing
    // renderer is a programmer error, surfaced loudly at import.
    if (Array.isArray(def.via)) {
      const channels = restrict ? def.via.filter((c) => restrict.includes(c)) : def.via;
      for (const channel of channels) {
        if (!def[channel]) {
          throw new MissingRendererError(def.type, channel);
        }
      }
    }

    return {
      send(to, data, options) {
        return dispatchAll(def, to, data, options ?? {}, "send", restrict);
      },
      queue(to, data, options) {
        return dispatchAll(def, to, data, options ?? {}, "queue", restrict);
      },
      only(...channels) {
        return make(channels);
      },
    };
  };

  return make();
}

/**
 * Fan-out to all recipients. Each recipient dispatches independently; one
 * recipient's transport failure never aborts the others. CONFIG errors,
 * however, propagate — they reject the returned promise.
 */
async function dispatchAll<Data>(
  def: NotificationDef<Data>,
  to: Notifiable | Notifiable[],
  data: Data,
  options: SendOptions,
  mode: DispatchMode,
  restrict?: ChannelName[],
): Promise<void> {
  const recipients = Array.isArray(to) ? to : [to];

  const results = await Promise.allSettled(
    recipients.map((recipient) =>
      dispatchToRecipient(def, recipient, data, options, mode, restrict),
    ),
  );

  rethrowConfigErrors(results);
}

async function dispatchToRecipient<Data>(
  def: NotificationDef<Data>,
  to: Notifiable,
  data: Data,
  options: SendOptions,
  mode: DispatchMode,
  restrict?: ChannelName[],
): Promise<void> {
  const config = getNotificationConfig();

  // Resolve channels (via + preferences). A throw here drops THIS recipient
  // with a log — it's a per-recipient data problem, not a config error.
  let channels: ChannelName[];
  try {
    channels = typeof def.via === "function" ? def.via(data, to) : [...def.via];

    if (restrict) {
      channels = channels.filter((c) => restrict.includes(c));
    }

    if (!options.force && config.preferences) {
      const allowed = await config.preferences.resolveChannels(to, def.type, channels);
      for (const channel of channels.filter((c) => !allowed.includes(c))) {
        await emit("skipped", { channel, notifiable: to, reason: "preference", options });
      }
      channels = channels.filter((c) => allowed.includes(c));
    }
  } catch (error) {
    log.error("notifications", `resolve.${def.type}`, error as Error);
    return;
  }

  const renderCtx: RenderContext = { locale: options.locale, meta: options.meta };

  const results = await Promise.allSettled(
    channels.map((name) => {
      const renderer = def[name] as Renderer<Data, ChannelName> | undefined;
      if (!renderer) {
        // Dynamic via chose a channel with no renderer — surface it.
        return Promise.reject(new MissingRendererError(def.type, name));
      }

      let payload: unknown = renderer(data, to, renderCtx);

      // Default the database channel's `type` from `def.type` when omitted.
      if (name === "database" && payload && typeof payload === "object" && !("type" in payload)) {
        payload = { ...(payload as object), type: def.type };
      }

      return dispatchChannel({
        channelName: name,
        payload,
        to,
        notificationType: def.type,
        mode,
        options,
      });
    }),
  );

  rethrowConfigErrors(results);
}

/** Collect config-class rejections and rethrow (single or AggregateError). */
function rethrowConfigErrors(results: PromiseSettledResult<unknown>[]): void {
  const configErrors = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected" && isConfigError(r.reason))
    .map((r) => r.reason);

  if (configErrors.length === 1) {
    throw configErrors[0];
  }
  if (configErrors.length > 1) {
    throw new AggregateError(configErrors, "Multiple notification configuration errors");
  }
}

/**
 * Typed event bus for notifications observability. Emits `sent`, `failed`,
 * and `skipped` events per (channel, recipient) — fan-out emits N events.
 *
 * Intentionally minimal — a `Map<event, Set<handler>>` keeps tests trivial
 * and avoids pulling event-emitter machinery for what is fundamentally
 * pub/sub. Handler exceptions are logged-and-swallowed so one bad listener
 * cannot break the dispatcher.
 *
 * @example
 *   notifications.on("sent",    ({ channel }) => metrics.inc(`notif.${channel}.sent`));
 *   notifications.on("skipped", ({ reason })  => metrics.inc(`notif.skipped.${reason}`));
 *   const off = notifications.on("failed", logErr);
 *   off(); // unsubscribe
 */
import { log } from "@warlock.js/logger";
import type { NotificationEvents } from "../types";

type EventName = keyof NotificationEvents;
type Handler<E extends EventName> = (data: NotificationEvents[E]) => void | Promise<void>;

const handlers: { [E in EventName]: Set<Handler<E>> } = {
  sent: new Set(),
  failed: new Set(),
  skipped: new Set(),
};

/**
 * Public observability surface.
 *
 * `on(event, handler)` returns an unsubscribe function. `off` exists for
 * symmetry with libraries that hold handler references for later removal.
 */
export const notifications = {
  on<E extends EventName>(event: E, handler: Handler<E>): () => void {
    handlers[event].add(handler as Handler<EventName>);
    return () => {
      handlers[event].delete(handler as Handler<EventName>);
    };
  },
  off<E extends EventName>(event: E, handler: Handler<E>): void {
    handlers[event].delete(handler as Handler<EventName>);
  },
};

/**
 * Internal emit — used by the dispatcher. Not exported from the package.
 * Handlers run in registration order; an awaited Promise.allSettled isolates
 * each listener so one throw cannot block the others.
 */
export async function emit<E extends EventName>(
  event: E,
  data: NotificationEvents[E],
): Promise<void> {
  const set = handlers[event];
  if (set.size === 0) return;

  // The `async` wrapper turns SYNC handler throws into promise rejections so
  // `Promise.allSettled` can isolate them. Without it, a `throw` inside the
  // handler escapes the array map before allSettled gets a chance to catch.
  const results = await Promise.allSettled(
    Array.from(set).map(async (handler) => {
      await (handler as Handler<E>)(data);
    }),
  );

  for (const result of results) {
    if (result.status === "rejected") {
      log.error("notifications", "event-handler", result.reason);
    }
  }
}

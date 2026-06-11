import type { Id, Notifiable, SendOptions } from "../types";

/**
 * A channel = one `send` + how it resolves a route from a notifiable.
 *
 * `route` is optional because some channels (raw-target ad-hoc sends, the
 * database channel) compute the route from the recipient's `.id` directly.
 * When `route` returns `undefined`, the dispatcher tries `notifiable.id` as
 * a fallback.
 */
export interface Channel<P> {
  /** Unique channel name — matches the key in `NotificationChannels`. */
  readonly name: string;

  /**
   * Resolve the per-recipient address this channel ships to. String for
   * external transports (`"user@example.com"`); `{ id }` for the database
   * channel and any internal storage.
   */
  route?(notifiable: Notifiable): string | { id: Id } | undefined;

  /**
   * Dispatch one already-rendered payload to one resolved route.
   * The dispatcher fans out across recipients before calling `send`.
   */
  send(ctx: {
    payload: P;
    route: string | { id: Id };
    notifiable?: Notifiable;
    options: SendOptions;
  }): Promise<void>;
}

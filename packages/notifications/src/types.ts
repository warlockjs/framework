/**
 * Public types for `@warlock.js/notifications`.
 *
 * Contracts (interfaces) live under `./contracts/`. This file holds the type
 * ALIASES + the channel/payload REGISTRY (`NotificationChannels`) that custom
 * channels extend via `declare module`.
 */
import type { Model } from "@warlock.js/cascade";

// ─── Identity ──────────────────────────────────────────────────────────────

/**
 * A recipient you send TO (a User, etc.) — NOT the stored record.
 * It's a cascade `Model` instance, so `.id` (number | string) and `.get(path)`
 * are native. Routing is a CHANNEL concern (convention column + per-channel
 * `route` override in config), not a model concern — there is intentionally
 * NO `routeNotificationFor` on the model.
 */
export type Notifiable = Model;

/** An identifier — string (uuid / objectId) or number (auto-increment). */
export type Id = string | number;

// ─── Per-channel payloads — Phase 1 ────────────────────────────────────────

/** What the `mail` channel renders to and `core.sendMail` consumes. */
export type MailPayload = {
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
};

/** Normalized in-app record shape written through the database channel. */
export type NotificationInput = {
  recipientId: Id;
  type: string;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
  /** Unique-per-recipient dedupe key — see `SendOptions.idempotencyKey`. */
  idempotencyKey?: string;
};

/**
 * Database payload as seen by RENDERERS — `recipientId` is set by the channel
 * from the resolved route, not by the render closure.
 */
export type DatabasePayload = Omit<NotificationInput, "recipientId">;

// ─── Channel REGISTRY ──────────────────────────────────────────────────────

/**
 * Channel REGISTRY — the single declaration-merge target mapping channel NAME
 * → payload type. Drives `notify.<channel>` proxy typing and
 * `defineNotification` renderers. Custom channels extend via:
 *
 *   declare module "@warlock.js/notifications" {
 *     interface NotificationChannels { discord: { content: string } }
 *   }
 *
 * Phase 1 ships ONLY `mail` and `database`. Bridges-backed channels
 * (`whatsapp`, `telegram`, `push`, `slack`) ship in Phase 2 as the same
 * declaration-merge pattern.
 */
export interface NotificationChannels {
  mail: MailPayload;
  database: DatabasePayload;
}

export type ChannelName = keyof NotificationChannels;

// ─── Send options ──────────────────────────────────────────────────────────

/**
 * Per-send options — the optional 3rd arg of `notify.<channel>` / `send` /
 * `queue`. Lean by design: `queue` and `only` are METHODS on a defined
 * notification (one path each), not flags here.
 *
 * - `force` bypasses `PreferenceProvider` (security/critical sends). It does
 *   NOT bypass `RateLimiter` — that's a safety valve, not a UX preference.
 * - `idempotencyKey` dedupes on insert (database channel unique constraint)
 *   and on enqueue (queue dispatcher). Use for any send that may be retried.
 * - `type` opts ad-hoc `notify.<channel>` sends into preference/rate-limit
 *   gating. `defineNotification` reads its own `def.type` and ignores this.
 */
export type SendOptions = {
  /**
   * Delay the dispatch, e.g. `"10m"` / `"3d"` / `600` (seconds). RESERVED —
   * NOT honored yet: `.send()` always dispatches immediately, and the current
   * `.queue()` worker runs each job the moment it's consumed. Delayed delivery
   * lands with the delay-aware worker (Phase 2); until then this field is a
   * no-op on both paths.
   */
  delay?: number | string;
  /** Locale for rendering — passed to renderers via `RenderContext`. */
  locale?: string;
  /** Passthrough to channels + every observability event (via `options`). */
  meta?: Record<string, unknown>;
  /** Dedupe key for retry-safe sends. */
  idempotencyKey?: string;
  /** Bypass `PreferenceProvider`. Does NOT bypass `RateLimiter`. */
  force?: boolean;
  /** Notification type for ad-hoc gating (unused by `defineNotification`). */
  type?: string;
};

/** What a renderer receives as its 3rd arg — i18n + meta passthrough only. */
export type RenderContext = Pick<SendOptions, "locale" | "meta">;

// ─── Events ────────────────────────────────────────────────────────────────

/**
 * Event surface for metrics, logging, audits. Fires per (channel, recipient)
 * — fan-out emits N events.
 *
 * `dispatchId` is a unique id for ONE (channel, recipient) dispatch: `sending`
 * and its terminal `sent` / `failed` share it, so observers can pair them (for
 * spans, latency, or detecting a `sending` with no terminal — a hung send). A
 * `skipped` carries its own id (nothing precedes it).
 *
 * `durationMs` on `sent` / `failed` is the transport time for a synchronous
 * send; on a queued send it is the enqueue time (real delivery timing is
 * worker-side).
 */
export type NotificationEvents = {
  sending: {
    dispatchId: string;
    channel: string;
    notifiable?: Notifiable;
    payload: unknown;
    options: SendOptions;
  };
  sent: {
    dispatchId: string;
    channel: string;
    notifiable?: Notifiable;
    payload: unknown;
    options: SendOptions;
    durationMs: number;
  };
  failed: {
    dispatchId: string;
    channel: string;
    notifiable?: Notifiable;
    payload: unknown;
    error: Error;
    options: SendOptions;
    durationMs: number;
  };
  skipped: {
    dispatchId: string;
    channel: string;
    notifiable?: Notifiable;
    reason: "preference" | "rate-limit";
    options: SendOptions;
  };
};

/**
 * `columnMap` — how a notification model's logical roles map to the physical
 * columns of ITS table. The ONE source the model getters, the repository
 * (read filter + write mapping), the database channel, and the migration
 * factory all read, so they can never drift apart.
 *
 * Declared as a `static columnMap` on the model and ejected to userland, so
 * the dev owns it:
 *
 *   @RegisterModel()
 *   export class Notification extends DatabaseNotification {
 *     public static table = "notifications";
 *     public static columnMap: NotificationColumnMap = {
 *       tenant: "organization_id", // omit → single-tenant
 *       readAt: "read_at",         // read-state (see below)
 *     };
 *   }
 *
 * ## Read-state is chosen by which keys are PRESENT
 *
 * - `readAt` only → unread = `read_at IS NULL`; marking read stamps it.
 * - `isRead` only → unread = `is_read = false`; no timestamp.
 * - both        → `is_read` is the indexed flag used for filtering, `read_at`
 *                 records WHEN; marking read sets both.
 *
 * Declare neither and you get the `readAt`-only default — so a model can omit
 * `columnMap` entirely and still work.
 */

/**
 * The logical → physical column bindings a notification model may declare.
 * Every key is optional; `resolveColumnMap` fills the defaults. Values are the
 * app's real column names (rename-friendly: `readAt: "seen_at"`).
 */
export type NotificationColumnMap = {
  /** Recipient FK column. Default: `"user_id"`. */
  recipient?: string;
  /** Multi-tenant scope column, written from the recipient. Omit → single-tenant. */
  tenant?: string;
  /** Read-timestamp column. Present → read-state records "when". */
  readAt?: string;
  /** Read-flag column (indexed → fast unread filter). Present → read-state is a boolean. */
  isRead?: string;
};

/**
 * A `NotificationColumnMap` with the defaults applied. `recipient` is always
 * set, and at least one of `readAt` / `isRead` is always present (the resolver
 * falls back to `readAt`), so consumers never face a "no read-state" map.
 */
export type ResolvedNotificationColumnMap = {
  recipient: string;
  tenant?: string;
  readAt?: string;
  isRead?: string;
};

/** A model class that may carry the `columnMap` static. */
export type NotificationColumnMapHost = {
  columnMap?: NotificationColumnMap;
};

const DEFAULT_RECIPIENT_COLUMN = "user_id";
const DEFAULT_READ_AT_COLUMN = "read_at";

/**
 * Resolve a model's declared `columnMap` into a complete map: default the
 * recipient column, and fall back to a `read_at` timestamp when the model
 * declares no read-state column. The fallback guarantees the result always
 * has a usable read-state representation, so no boot-time validation is needed.
 */
export function resolveColumnMap(
  map: NotificationColumnMap | undefined,
): ResolvedNotificationColumnMap {
  const recipient = map?.recipient ?? DEFAULT_RECIPIENT_COLUMN;
  const tenant = map?.tenant;

  if (!map?.readAt && !map?.isRead) {
    return { recipient, tenant, readAt: DEFAULT_READ_AT_COLUMN };
  }

  return {
    recipient,
    tenant,
    readAt: map.readAt,
    isRead: map.isRead,
  };
}

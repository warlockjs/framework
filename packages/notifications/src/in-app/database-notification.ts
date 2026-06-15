/**
 * Shipped BASE in-app notification model. The scaffolded user model
 * `extends DatabaseNotification`, sets `static table`, and declares its
 * physical columns ONCE via `static columnMap`. Every accessor below derives
 * from that map, so the model, the repository, and the migration agree by
 * construction.
 *
 * The package ships NO concrete table or migration — those eject to userland
 * (thin eject). See `notificationColumns()` for the matching migration factory.
 *
 * @example
 *   @RegisterModel()
 *   export class Notification extends DatabaseNotification {
 *     public static table = "notifications";
 *     public static columnMap: NotificationColumnMap = {
 *       tenant: "organization_id",
 *       readAt: "read_at",
 *     };
 *   }
 */
import { Model } from "@warlock.js/cascade";
import type { NotificationContract } from "../contracts";
import type { Id } from "../types";
import {
  type NotificationColumnMap,
  type ResolvedNotificationColumnMap,
  resolveColumnMap,
} from "./column-map";

export abstract class DatabaseNotification extends Model implements NotificationContract {
  /**
   * Physical column bindings for THIS model's table. Override in the subclass;
   * the empty default resolves to `{ recipient: "user_id", readAt: "read_at" }`.
   */
  public static columnMap: NotificationColumnMap = {};

  /** The resolved column map for this row's model — defaults applied. */
  protected get columns(): ResolvedNotificationColumnMap {
    return resolveColumnMap((this.constructor as typeof DatabaseNotification).columnMap);
  }

  public get recipientId(): Id {
    return this.get(this.columns.recipient);
  }

  /** Tenant scope value, or `undefined` for single-tenant models. */
  public get tenantId(): Id | undefined {
    const { tenant } = this.columns;
    return tenant ? this.get(tenant) : undefined;
  }

  public get type(): string {
    return this.get("type");
  }

  public get isRead(): boolean {
    const { isRead, readAt } = this.columns;

    if (isRead) {
      return Boolean(this.get(isRead));
    }

    return readAt ? this.get(readAt) != null : false;
  }

  public get readAt(): Date | null {
    const { readAt } = this.columns;
    return readAt ? (this.get(readAt) ?? null) : null;
  }

  /**
   * Mark this row read. Sets whichever read-state column(s) the model
   * declares — the boolean (fast unread filtering) and/or the timestamp
   * (when it was read). Persists via `save()`.
   */
  public async markRead(): Promise<void> {
    const { isRead, readAt } = this.columns;

    if (isRead) {
      this.set(isRead, true);
    }

    if (readAt) {
      this.set(readAt, new Date());
    }

    await this.save();
  }
}

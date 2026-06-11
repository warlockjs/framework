/**
 * Shipped BASE in-app notification model. The scaffolded user model
 * `extends DatabaseNotification` and overrides getters ONLY where its
 * columns or driver differ. The accessors are the stable contract; the
 * physical columns are the app's.
 *
 * The package ships NO concrete table or migration — those eject to
 * userland (thin eject). Cross-driver column NAMES come from
 * `notificationColumns()` in the migration helper.
 *
 * @example
 *   @RegisterModel()
 *   export class Notification extends DatabaseNotification {
 *     public static table = "notifications";
 *     // override only when your driver / columns diverge:
 *     public get recipientId() { return this.get("user.id"); } // MongoDB nested
 *   }
 */
import { Model } from "@warlock.js/cascade";
import type { NotificationContract } from "../contracts";
import type { Id } from "../types";

export abstract class DatabaseNotification extends Model implements NotificationContract {
  public get recipientId(): Id {
    return this.get("user_id");
  }

  public get type(): string {
    return this.get("type");
  }

  public get isRead(): boolean {
    return this.get("is_read") ?? false;
  }

  public get readAt(): Date | null {
    return this.get("read_at") ?? null;
  }

  /**
   * Mark this row read. Sets both the boolean (for fast unread filtering)
   * AND the timestamp (for "when was this read"). Persists via `save()`.
   */
  public async markRead(): Promise<void> {
    this.set("is_read", true).set("read_at", new Date());
    await this.save();
  }
}

/**
 * Shipped behavior repository for the in-app store.
 *
 * Concrete (NOT abstract) so `inApp.configure({ model })` can
 * `new BaseNotificationsRepository(model)` without subclassing. The dev only
 * extends this when they need custom column mappings or extra query methods.
 *
 * ## The single source of truth: `filterBy`
 *
 * `filterBy` maps LOGICAL keys (`recipientId`, `isRead`, `readAt`,
 * `idempotencyKey`) → PHYSICAL columns (`user_id`, `is_read`, …). The cascade
 * `RepositoryManager` applies it on the READ path automatically. The WRITE +
 * UPDATE + DELETE paths bypass it, so we derive a `toRow()` mapper FROM the
 * same `filterBy` and apply it ourselves — reads and writes therefore share
 * ONE mapping. A subclass that remaps a column overrides `filterBy` ONCE and
 * both paths stay consistent.
 *
 * @example  default (SQL snake_case — no subclass needed)
 *   inApp.configure({ model: Notification })
 *
 * @example  custom column names (e.g. MongoDB camelCase, or a renamed column)
 *   class MyRepo extends BaseNotificationsRepository<MyNotification> {
 *     public source = MyNotification;
 *     public filterBy = {
 *       ...this.filterBy,
 *       recipientId: ["=", "audience_id"],
 *       isRead:      ["=", "seen"],
 *     };
 *   }
 *   inApp.configure({ repository: new MyRepo() });
 */
import { type FilterRules, RepositoryManager } from "@warlock.js/core";
import type { NotificationContract } from "../contracts";
import type { DatabasePayload, Id } from "../types";
import type { DatabaseNotification } from "./database-notification";

/**
 * Filter shape — logical keys the repo understands. `filterBy` maps each to
 * an operator (or `[operator, physical-column]`) for the adapter.
 */
export type NotificationsFilter = {
  id?: Id;
  type?: string;
  isRead?: boolean;
  recipientId?: Id;
  idempotencyKey?: string;
};

/** Class form of a `DatabaseNotification` subclass — what `configure()` accepts. */
export type NotificationModelClass = new (...args: any[]) => DatabaseNotification;

export class BaseNotificationsRepository<
  TModel extends NotificationContract = NotificationContract,
> extends RepositoryManager<TModel, NotificationsFilter> {
  /**
   * Logical → physical mapping, snake_case by default. `readAt` is here (even
   * though it's rarely a filter) so `toRow()` maps it on writes. Override this
   * ONCE in a subclass to retarget columns; both read and write paths follow.
   */
  public filterBy: FilterRules = {
    id: "=",
    type: "=",
    isRead: ["=", "is_read"],
    readAt: ["=", "read_at"],
    recipientId: ["=", "user_id"],
    idempotencyKey: ["=", "idempotency_key"],
  };

  public constructor(model?: NotificationModelClass) {
    super();
    if (model) {
      this.source = model;
    }
  }

  /**
   * Translate an object keyed by LOGICAL names into one keyed by PHYSICAL
   * columns, using `filterBy` as the lookup. Keys with no `[op, column]`
   * tuple (e.g. `title`, `body`, `payload`, `type`, `id`) pass through
   * unchanged — they're already physical. Used for every write / update /
   * delete payload + filter (the paths `RepositoryManager` does NOT map).
   */
  protected toRow(obj: Record<string, unknown>): Record<string, unknown> {
    const rules = this.filterBy as Record<string, unknown>;
    const row: Record<string, unknown> = {};

    for (const [logical, value] of Object.entries(obj)) {
      const rule = rules[logical];
      const column = Array.isArray(rule) ? (rule[1] as string) : logical;
      row[column] = value;
    }

    return row;
  }

  /**
   * Create one row for the recipient. New rows start unread.
   *
   * Idempotency: when `input.idempotencyKey` is set, find-or-create — return
   * the existing row instead of inserting a duplicate. A unique index on the
   * key is the backstop for the rare insert race (we re-fetch on conflict).
   */
  public async createFor(recipientId: Id, input: DatabasePayload): Promise<TModel> {
    const { idempotencyKey } = input;

    if (idempotencyKey) {
      const existing = await this.firstByIdempotencyKey(recipientId, idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    try {
      return await this.create(this.toRow({ recipientId, isRead: false, ...input }));
    } catch (error) {
      // Lost the insert race to a concurrent send with the same key → re-fetch.
      if (idempotencyKey) {
        const existing = await this.firstByIdempotencyKey(recipientId, idempotencyKey);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  /**
   * Bulk-create one row per recipient sharing the same input. Reserved for the
   * Phase-2 `Channel.sendMany` fan-out hook; not on the per-recipient send
   * path yet. Phase-0 impl is `Promise.all(map(createFor))`.
   */
  public createManyFor(recipientIds: Id[], input: DatabasePayload): Promise<TModel[]> {
    return Promise.all(recipientIds.map((recipientId) => this.createFor(recipientId, input)));
  }

  /**
   * Mark rows read — recipient-scoped. `id` omitted → all unread rows for the
   * recipient; `id` given → that one row, still scoped to the recipient.
   * Filter + data are mapped to physical columns via `toRow`.
   */
  public markRead(recipientId: Id, id?: Id): Promise<number> {
    return this.updateMany(
      this.toRow({ recipientId, isRead: false, ...(id !== undefined ? { id } : {}) }),
      this.toRow({ isRead: true, readAt: new Date() }),
    );
  }

  /** Inverse of `markRead`, same recipient-scoping. */
  public markUnread(recipientId: Id, id?: Id): Promise<number> {
    return this.updateMany(
      this.toRow({ recipientId, isRead: true, ...(id !== undefined ? { id } : {}) }),
      this.toRow({ isRead: false, readAt: null }),
    );
  }

  /** Find one row for a recipient (read path — `filterBy` maps the keys). */
  public findFor(recipientId: Id, id: Id): Promise<TModel | null> {
    return this.first({ recipientId, id } as NotificationsFilter);
  }

  /**
   * Delete rows — recipient-scoped. `id` omitted → clear all for the
   * recipient; `id` given → that one row.
   */
  public deleteFor(recipientId: Id, id?: Id): Promise<number> {
    return this.deleteMany(this.toRow({ recipientId, ...(id !== undefined ? { id } : {}) }));
  }

  /** Read path — `filterBy` maps `recipientId`/`idempotencyKey` to columns. */
  private firstByIdempotencyKey(recipientId: Id, idempotencyKey: string): Promise<TModel | null> {
    return this.first({ recipientId, idempotencyKey } as NotificationsFilter);
  }
}

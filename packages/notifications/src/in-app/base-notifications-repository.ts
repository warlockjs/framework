/**
 * Shipped behavior repository for the in-app store.
 *
 * Concrete (NOT abstract) so `inApp.configure({ model })` can
 * `new BaseNotificationsRepository(model)` without subclassing. The dev only
 * extends this when they need extra query methods.
 *
 * ## The single source of truth: the model's `columnMap`
 *
 * The model declares its physical columns ONCE via `static columnMap`. The
 * constructor resolves that map and derives BOTH sides from it:
 *
 *  - the READ path — `filterBy` maps logical keys (`recipientId`, `unread`,
 *    `type`, …) onto the model's columns; `RepositoryManager` applies it.
 *  - the WRITE / UPDATE / DELETE path — `createFor` / `markRead` / … translate
 *    logical keys through the same `filterBy` via `toRow`.
 *
 * Because both come from one `columnMap`, reads and writes can never target
 * different columns. `unread` is mode-agnostic: it filters `is_read = false`
 * when the model has that flag, otherwise `read_at IS NULL`.
 *
 * @example  default (SQL snake_case — no subclass needed)
 *   inApp.configure({ model: Notification })
 *
 * @example  custom columns — declare them on the model, not here
 *   class Notification extends DatabaseNotification {
 *     public static columnMap = { recipient: "audience_id", isRead: "seen" };
 *   }
 */
import { type FilterRules, RepositoryManager } from "@warlock.js/core";
import type { NotificationContract } from "../contracts";
import type { DatabasePayload, Id } from "../types";
import {
  type NotificationColumnMapHost,
  type ResolvedNotificationColumnMap,
  resolveColumnMap,
} from "./column-map";
import type { DatabaseNotification } from "./database-notification";

/**
 * Filter shape — logical keys the repo understands. `filterBy` maps each to a
 * physical column (or a predicate) derived from the model's `columnMap`.
 */
export type NotificationsFilter = {
  id?: Id;
  type?: string;
  /** Mode-agnostic unread filter — resolves to the model's read-state column. */
  unread?: boolean;
  recipientId?: Id;
  idempotencyKey?: string;
};

/** Class form of a `DatabaseNotification` subclass — what `configure()` accepts. */
export type NotificationModelClass = (new (...args: any[]) => DatabaseNotification) &
  NotificationColumnMapHost;

export class BaseNotificationsRepository<
  TModel extends NotificationContract = NotificationContract,
> extends RepositoryManager<TModel, NotificationsFilter> {
  /** Resolved physical columns for the bound model — the single source. */
  private readonly columns: ResolvedNotificationColumnMap;

  public filterBy: FilterRules;

  public constructor(model?: NotificationModelClass) {
    super();

    if (model) {
      this.source = model;
    }

    this.columns = resolveColumnMap(model?.columnMap);
    this.filterBy = this.buildFilterBy();
  }

  /** The tenant column for this model, or `undefined` for single-tenant. */
  public get tenantColumn(): string | undefined {
    return this.columns.tenant;
  }

  /**
   * Build `filterBy` from the resolved column map. `unread` is the
   * mode-agnostic read filter; `isRead` / `readAt` / `tenant` are exposed for
   * direct filtering only when the model declares those columns.
   */
  private buildFilterBy(): FilterRules {
    const { recipient, tenant, readAt, isRead } = this.columns;

    const rules: FilterRules = {
      id: "=",
      type: "=",
      recipientId: ["=", recipient],
      idempotencyKey: ["=", "idempotency_key"],
      unread: (value, query) => {
        if (value !== true && value !== "true") {
          return;
        }

        if (isRead) {
          query.where(isRead, false);
        } else if (readAt) {
          query.whereNull(readAt);
        }
      },
    };

    if (isRead) {
      rules.isRead = ["=", isRead];
    }

    if (readAt) {
      rules.readAt = ["=", readAt];
    }

    if (tenant) {
      rules.tenant = ["=", tenant];
    }

    return rules;
  }

  /**
   * Translate an object keyed by LOGICAL names into one keyed by PHYSICAL
   * columns, using `filterBy` as the lookup. Keys with no `[op, column]` tuple
   * (e.g. `title`, `body`, `payload`, `type`, `id`) pass through unchanged —
   * they're already physical. Used for every write / update / delete payload +
   * filter (the paths `RepositoryManager` does NOT map).
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
   * Create one row for the recipient. New rows start unread; the tenant column
   * (when the model declares one) is written from `tenantId`, which the
   * database channel reads off the recipient.
   *
   * Idempotency: when `input.idempotencyKey` is set, find-or-create — return
   * the existing row instead of inserting a duplicate. A unique index on the
   * key is the backstop for the rare insert race (we re-fetch on conflict).
   */
  public async createFor(
    recipientId: Id,
    input: DatabasePayload,
    tenantId?: Id,
  ): Promise<TModel> {
    const { idempotencyKey } = input;

    if (idempotencyKey) {
      const existing = await this.firstByIdempotencyKey(recipientId, idempotencyKey);
      if (existing) {
        return existing;
      }
    }

    const row: Record<string, unknown> = { recipientId, ...input };

    if (this.columns.isRead) {
      row.isRead = false;
    }

    if (this.columns.tenant && tenantId !== undefined) {
      row.tenant = tenantId;
    }

    try {
      return await this.create(this.toRow(row));
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
   * Bulk-create one row per recipient sharing the same input + tenant. Reserved
   * for the Phase-2 `Channel.sendMany` fan-out hook; not on the per-recipient
   * send path yet.
   */
  public createManyFor(
    recipientIds: Id[],
    input: DatabasePayload,
    tenantId?: Id,
  ): Promise<TModel[]> {
    return Promise.all(
      recipientIds.map((recipientId) => this.createFor(recipientId, input, tenantId)),
    );
  }

  /**
   * Mark rows read — recipient-scoped. `id` omitted → all unread rows for the
   * recipient; `id` given → that one row, still scoped to the recipient. Scoped
   * to unread so a re-mark never overwrites an earlier `read_at` timestamp.
   * Sets whichever read-state column(s) the model declares.
   */
  public markRead(recipientId: Id, id?: Id): Promise<number> {
    const { isRead, readAt } = this.columns;
    const unreadScope = isRead ? { isRead: false } : { readAt: null };

    const data: Record<string, unknown> = {};

    if (isRead) {
      data.isRead = true;
    }

    if (readAt) {
      data.readAt = new Date();
    }

    return this.updateMany(
      this.toRow({ recipientId, ...unreadScope, ...(id !== undefined ? { id } : {}) }),
      this.toRow(data),
    );
  }

  /**
   * Inverse of `markRead`, same recipient-scoping. No unread scope needed —
   * clearing the read-state of an already-unread row is a no-op.
   */
  public markUnread(recipientId: Id, id?: Id): Promise<number> {
    const { isRead, readAt } = this.columns;
    const data: Record<string, unknown> = {};

    if (isRead) {
      data.isRead = false;
    }

    if (readAt) {
      data.readAt = null;
    }

    return this.updateMany(
      this.toRow({ recipientId, ...(id !== undefined ? { id } : {}) }),
      this.toRow(data),
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

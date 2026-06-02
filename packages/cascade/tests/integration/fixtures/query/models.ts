/**
 * Shared fixtures for the cascade QUERY + PERSISTENCE integration suites
 * (Postgres + MongoDB). These models back the WHERE-operator, ordering,
 * pagination, aggregate, and persistence tests that exercise the real drivers
 * against live containers.
 *
 * Table / collection names are namespaced with a `q_` prefix so they never
 * clash with the sibling CRUD suite (`integration_users`) or the relation
 * suite (`rel_*`).
 *
 * Three models are exposed:
 *
 *   QUser    — the primary subject for WHERE/order/aggregate/distinct tests.
 *   QOrder   — a child-shaped table used for groupBy / having / sum / avg.
 *   QArticle — carries a `notDeleted` global scope so the soft-delete suite can
 *              prove Cascade hides scoped rows from default queries while the
 *              raw row survives in the database (Cascade does NOT auto-hide
 *              soft-deleted rows — the scope is opt-in).
 *
 * The Postgres DDL for these lives next to this file in `schema.ts`. MongoDB
 * needs no DDL — collections are created on first write.
 */
import type { QueryBuilderContract } from "../../../../src/contracts/query-builder.contract";
import { Model } from "../../../../src/model/model";
import type { GlobalScopeDefinition } from "../../../../src/model/model.types";

export const USERS_TABLE = "q_users";
export const ORDERS_TABLE = "q_orders";
export const ARTICLES_TABLE = "q_articles";

/**
 * Primary query subject. Columns cover every WHERE operator family plus the
 * fields aggregate / distinct / groupBy tests read.
 */
export class QUser extends Model {
  public static table = USERS_TABLE;
}

/**
 * Order-shaped rows grouped by `status` in the aggregate suite. `amount` is a
 * numeric column so SUM / AVG / MIN / MAX return meaningful decimals.
 */
export class QOrder extends Model {
  public static table = ORDERS_TABLE;
}

/**
 * Soft-delete subject. The `notDeleted` global scope appends
 * `WHERE deletedAt IS NULL` to every query, so a soft-deleted article
 * disappears from `QArticle.all()` while the row remains in the table with a
 * populated `deletedAt`. The scope is bypassed with
 * `withoutGlobalScope("notDeleted")` to surface trashed rows.
 */
export class QArticle extends Model {
  public static table = ARTICLES_TABLE;

  public static deleteStrategy = "soft" as const;

  public static deletedAtColumn = "deletedAt";

  // Own the scope map so the `notDeleted` scope stays local to this model.
  // `Model.globalScopes` is a single inherited Map shared by every subclass, so
  // without this fresh instance the scope would leak onto QUser / QOrder
  // queries (and fail with "column deletedAt does not exist").
  public static globalScopes = new Map<string, GlobalScopeDefinition>();

  static {
    this.addGlobalScope("notDeleted", (query: QueryBuilderContract) => {
      query.whereNull("deletedAt");
    });
  }
}

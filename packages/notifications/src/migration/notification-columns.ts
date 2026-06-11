/**
 * Driver-aware column factory for the notifications table.
 *
 * Reads the model's `static dataSource` (or the active default) and returns
 * snake_case columns on PG/MySQL or camelCase columns on MongoDB. The shape
 * is identical — only the column NAMES differ — so a single user model
 * `extends DatabaseNotification` works against either driver with the right
 * getter overrides.
 *
 * Spread + extend for extras (multi-tenant `organization_id`, etc.).
 *
 * @example
 *   import { Migration } from "@warlock.js/cascade";
 *   import { notificationColumns } from "@warlock.js/notifications";
 *   import { Notification } from "../notification.model";
 *
 *   export default Migration.create(Notification, notificationColumns(Notification));
 *
 * @example  // with extras (multi-tenant)
 *   export default Migration.create(Notification, {
 *     ...notificationColumns(Notification),
 *     organization_id: uuid().index().notNullable(),
 *   });
 */
import { boolCol, json, string, text, timestamp, uuid } from "@warlock.js/cascade";

/**
 * Minimal shape of `static dataSource` on a cascade Model — string name OR
 * a registered `DataSource` object whose `name` is the driver tag.
 *
 * We accept `unknown` for safety; only the literal `"mongodb"` triggers the
 * camelCase branch. Anything else (or unset) falls through to SQL columns.
 */
type DataSourceShape = string | { name?: string } | undefined;

const isMongo = (ds: DataSourceShape): boolean => {
  if (!ds) return false;
  if (typeof ds === "string") return ds === "mongodb";
  return ds.name === "mongodb";
};

const sqlColumns = () => ({
  user_id: uuid().index().notNullable(),
  type: string().index().notNullable(),
  title: string().notNullable(),
  body: text().nullable(),
  payload: json().nullable(),
  is_read: boolCol().default(false).index(),
  read_at: timestamp().nullable(),
  // Unique so a retried send can't insert a duplicate. Nullable: most rows
  // have no key (NULLs are distinct in a unique index). `createFor` does
  // find-or-create; this constraint is the race backstop.
  idempotency_key: string().nullable().unique(),
});

const mongoColumns = () => ({
  userId: uuid().index().notNullable(),
  type: string().index().notNullable(),
  title: string().notNullable(),
  body: text().nullable(),
  payload: json().nullable(),
  isRead: boolCol().default(false).index(),
  readAt: timestamp().nullable(),
  idempotencyKey: string().nullable().unique(),
});

export type NotificationColumnsMap = ReturnType<typeof sqlColumns> | ReturnType<typeof mongoColumns>;

/**
 * Returns the driver-appropriate column map for a notification table.
 *
 * Argument is a Model class (`{ dataSource }` static); detection is based on
 * the value of that static field. Without a model, defaults to SQL columns.
 */
export function notificationColumns(
  model?: { dataSource?: DataSourceShape },
): NotificationColumnsMap {
  return isMongo(model?.dataSource) ? mongoColumns() : sqlColumns();
}

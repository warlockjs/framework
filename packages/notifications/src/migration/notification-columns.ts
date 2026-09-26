/**
 * Column factory for the notifications table, driven by the model's
 * `columnMap`. The recipient / read-state / tenant columns take the NAMES the
 * model declares, so the table, the repository, and the model accessors all
 * agree by construction. The stable lexical columns (`type`, `title`, `body`,
 * `payload`, `idempotency_key`) keep fixed names.
 *
 * Read-state follows the map's presence rules (see `NotificationColumnMap`):
 * `readAt` → a nullable timestamp, `isRead` → an indexed boolean, both → both.
 *
 * Spread + extend for app-specific extras (FK references, composite indexes).
 *
 * @example
 *   import { Migration } from "@warlock.js/cascade";
 *   import { notificationColumns } from "@warlock.js/notifications";
 *   import { Notification } from "../notification.model";
 *
 *   export default Migration.create(Notification, notificationColumns(Notification));
 *
 * @example  // with extras (multi-tenant FK)
 *   export default Migration.create(Notification, {
 *     ...notificationColumns(Notification),
 *     organization_id: uuid().references(Organization.table).notNullable(),
 *   });
 */
import { bigInteger, boolCol, type ColumnMap, integer, json, string, text, timestamp, uuid } from "@warlock.js/cascade";
import { type NotificationColumnMapHost, resolveColumnMap } from "../in-app/column-map";

export type NotificationIdType = "uuid" | "bigint" | "integer" | "string";

export type NotificationColumnsOptions = {
  /** The type used for recipient and tenant identifiers. Defaults to UUID. */
  idType?: NotificationIdType;
};

/**
 * Returns the column map for a notification table, named from the model's
 * `columnMap`. Without a model, falls back to the resolved defaults
 * (`user_id` recipient + `read_at` read-state).
 */
export function notificationColumns(options?: NotificationColumnsOptions): ColumnMap;
export function notificationColumns(model?: NotificationColumnMapHost, options?: NotificationColumnsOptions): ColumnMap;
export function notificationColumns(
  modelOrOptions?: NotificationColumnMapHost | NotificationColumnsOptions,
  options?: NotificationColumnsOptions,
): ColumnMap {
  const model = isNotificationColumnsOptions(modelOrOptions) ? undefined : modelOrOptions;
  const idType = (isNotificationColumnsOptions(modelOrOptions) ? modelOrOptions : options)?.idType ?? "uuid";
  const { recipient, tenant, readAt, isRead } = resolveColumnMap(model?.columnMap);
  const idColumn = getIdColumn(idType);

  const columns: ColumnMap = {
    [recipient]: idColumn().index().notNullable(),
    type: string().index().notNullable(),
    title: string().notNullable(),
    body: text().nullable(),
    payload: json().nullable(),
  };

  if (readAt) {
    columns[readAt] = timestamp().nullable();
  }

  if (isRead) {
    columns[isRead] = boolCol().default(false).index();
  }

  if (tenant) {
    columns[tenant] = idColumn().index().notNullable();
  }

  // Unique so a retried send can't insert a duplicate. Nullable: most rows
  // have no key (NULLs are distinct in a unique index). `createFor` does
  // find-or-create; this constraint is the race backstop.
  columns.idempotency_key = string().nullable().unique();

  return columns;
}

function isNotificationColumnsOptions(
  value: NotificationColumnMapHost | NotificationColumnsOptions | undefined,
): value is NotificationColumnsOptions {
  return "idType" in (value ?? {});
}

function getIdColumn(idType: NotificationIdType) {
  switch (idType) {
    case "bigint":
      return bigInteger;
    case "integer":
      return integer;
    case "string":
      return string;
    default:
      return uuid;
  }
}

import { Model } from "@warlock.js/cascade";

/**
 * Settings shared by the monitor's tables. Ids are supplied by the store
 * (random uuids, or `"state"`), times are plain epoch-millisecond columns the
 * store writes itself, and a removal is always permanent: sessions, invites
 * and samples must not be copied into a trash table.
 */
export abstract class DevtoolsRowModel extends Model {
  public static autoGenerateId = false;

  public static createdAtColumn = false as const;

  public static updatedAtColumn = false as const;

  public static deleteStrategy = "permanent" as const;
}

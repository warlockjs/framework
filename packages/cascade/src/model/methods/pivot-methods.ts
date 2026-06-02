import { createPivotOperations, type PivotOperations } from "../../relations/pivot-operations";
import type { PivotData, PivotIds } from "../../relations/types";
import type { Model } from "../model";

/**
 * Get the pivot-operations handle for a `belongsToMany` relation.
 *
 * Returns the `PivotOperations` object exposing `attach` / `detach` /
 * `sync` / `toggle` for the named relation's pivot table.
 *
 * @throws Error if the relation is not a belongsToMany relation.
 *
 * @example
 * await post.pivot("tags").attach([1, 2, 3]);
 * await post.pivot("tags").sync([1, 3, 5]);
 * await post.pivot("tags").toggle([1, 7]);
 */
export function pivotRelation(model: Model, relation: string): PivotOperations {
  return createPivotOperations(model, relation);
}

/**
 * Attach one or more related records to a belongsToMany pivot table.
 *
 * @throws Error if the relation is not a belongsToMany relation.
 *
 * @example
 * await post.attach("tags", [1, 2, 3]);
 * await post.attach("tags", [4], { addedBy: currentUserId });
 */
export async function attachPivotRelation(
  model: Model,
  relation: string,
  ids: PivotIds,
  pivotData?: PivotData,
): Promise<void> {
  return createPivotOperations(model, relation).attach(ids, pivotData);
}

/**
 * Detach related records from a belongsToMany pivot table. Omit `ids` to
 * detach every row for this side of the relation.
 *
 * @throws Error if the relation is not a belongsToMany relation.
 *
 * @example
 * await post.detach("tags", [2]);
 * await post.detach("tags"); // detach all
 */
export async function detachPivotRelation(
  model: Model,
  relation: string,
  ids?: PivotIds,
): Promise<void> {
  return createPivotOperations(model, relation).detach(ids);
}

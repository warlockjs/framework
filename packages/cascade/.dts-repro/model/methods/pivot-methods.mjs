import { createPivotOperations } from "../../relations/pivot-operations.mjs";
//#region ../../@warlock.js/cascade/src/model/methods/pivot-methods.ts
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
function pivotRelation(model, relation) {
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
async function attachPivotRelation(model, relation, ids, pivotData) {
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
async function detachPivotRelation(model, relation, ids) {
	return createPivotOperations(model, relation).detach(ids);
}
//#endregion
export { attachPivotRelation, detachPivotRelation, pivotRelation };

//# sourceMappingURL=pivot-methods.mjs.map
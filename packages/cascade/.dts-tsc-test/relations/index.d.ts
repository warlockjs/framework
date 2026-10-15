/**
 * @fileoverview Relations module for the Cascade ORM.
 *
 * This module exports all the types, helper functions, and classes
 * needed for defining and loading model relationships.
 *
 * @module @warlock.js/cascade/relations
 *
 * @example
 * ```typescript
 * import {
 *   hasMany,
 *   belongsTo,
 *   belongsToMany,
 *   hasOne,
 *   RelationLoader,
 *   type RelationDefinition,
 * } from "@warlock.js/cascade";
 *
 * class User extends Model {
 *   static relations = {
 *     posts: hasMany("Post"),
 *     organization: belongsTo("Organization"),
 *     roles: belongsToMany("Role", { pivot: "user_roles" }),
 *   };
 * }
 * ```
 */
export type { BelongsToManyOptions, BelongsToOptions, HasManyOptions, HasOneOptions, LoadedRelationResult, LoadedRelationsMap, PivotData, PivotIds, RelationConstraintCallback, RelationConstraints, RelationDefinition, RelationDefinitions, RelationType, } from "./types";
export { RelationLoader } from "./relation-loader";
export { RelationHydrator } from "./relation-hydrator";
export type { ModelSnapshot, SerializedRelation } from "./relation-hydrator";
export { PivotOperations, createPivotOperations } from "./pivot-operations";
//# sourceMappingURL=index.d.ts.map
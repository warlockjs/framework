import { RelationDefinition } from "./types.mjs";
import { Model } from "../model/model.mjs";

//#region ../../@warlock.js/cascade/src/relations/relation-hydrator.d.ts
/**
 * The serialized shape of a single relation entry inside a model snapshot.
 * Each value is either:
 * - `null`  — the relation was loaded and resolved to nothing (e.g. belongsTo with no match)
 * - A nested snapshot object `{ data, relations }` — a single related model
 * - An array of nested snapshot objects — a collection relation
 */
type SerializedRelation = null | ModelSnapshot | ModelSnapshot[];
/**
 * The plain-object shape produced by `model.toSnapshot()` and consumed by
 * `Model.fromSnapshot()`. The `relations` map uses the same relation names
 * defined in the model's static `relations` property.
 */
type ModelSnapshot = {
  data: Record<string, unknown>;
  relations: Record<string, SerializedRelation>;
};
/**
 * Restores eager-loaded relations from a plain snapshot onto a model instance.
 *
 * Mirrors the interface of RelationLoader but instead of issuing DB queries,
 * it recursively instantiates related models from serialized snapshot data.
 *
 * @example
 * ```typescript
 * // Used internally by Model.fromSnapshot():
 * const model = new Chat(snapshot.data);
 * RelationHydrator.hydrate(model, Chat.relations, snapshot.relations);
 * ```
 */
declare class RelationHydrator {
  /**
   * Hydrate all relations from a snapshot onto `model`.
   *
   * - Looks up each relation name in `relationDefs` to find the target model class.
   * - Recursively calls `fromSnapshot` on nested snapshots so deeply nested
   *   relations are fully hydrated as well.
   * - Sets each relation on both `model.loadedRelations` (Map) and as a direct
   *   property (`model[name]`) to match the behaviour of RelationLoader.
   * - Intentionally preserves `null` entries — a null relation was explicitly
   *   loaded and resolved to nothing; this is different from a missing relation.
   *
   * @param model - The model instance to attach relations to
   * @param relationDefs - The static `relations` map from the model class
   * @param relationsSnapshot - The `relations` portion of a `ModelSnapshot`
   */
  static hydrate(model: Model, relationDefs: Record<string, RelationDefinition>, relationsSnapshot: Record<string, SerializedRelation> | undefined): void;
}
//#endregion
export { ModelSnapshot, RelationHydrator, SerializedRelation };
//# sourceMappingURL=relation-hydrator.d.mts.map
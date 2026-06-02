import { resolveModelClass } from "../model/register-model.mjs";
//#region ../../@warlock.js/cascade/src/relations/relation-hydrator.ts
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
var RelationHydrator = class {
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
	static hydrate(model, relationDefs, relationsSnapshot) {
		if (!relationsSnapshot) return;
		for (const [name, snapshot] of Object.entries(relationsSnapshot)) {
			const def = relationDefs[name];
			if (!def) continue;
			const RelModel = resolveModelClass(def.model);
			if (!RelModel) continue;
			let hydrated;
			if (snapshot === null) hydrated = null;
			else if (Array.isArray(snapshot)) hydrated = snapshot.map((item) => RelModel.fromSnapshot(item));
			else hydrated = RelModel.fromSnapshot(snapshot);
			model.loadedRelations.set(name, hydrated);
			model[name] = hydrated;
		}
	}
};
//#endregion
export { RelationHydrator };

//# sourceMappingURL=relation-hydrator.mjs.map
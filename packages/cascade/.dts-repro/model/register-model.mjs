import { RELATION_METADATA_KEY } from "./relation-decorators.mjs";
import { isLazy } from "@mongez/reinforcements";
//#region ../../@warlock.js/cascade/src/model/register-model.ts
/**
* Global model registry that maps model class names to their constructors.
* This allows for string-based model references to avoid circular dependencies.
*/
const modelsRegistry = /* @__PURE__ */ new Map();
/**
* Class decorator that registers a model in the global registry.
*
* This is an opt-in mechanism that allows models to be referenced by string name
* instead of direct class imports, helping avoid circular dependencies.
*
* Uses the **TC39 Stage 3 decorator** signature (standard since TypeScript 5.0).
* Requires `experimentalDecorators: false` (or unset) in `tsconfig.json`.
*
* @param options - Optional configuration for registration
*
* @example
* ```typescript
* // Auto-capture class name
* @RegisterModel()
* export class User extends Model {
*   static table = "users";
* }
*
* // Custom name
* @RegisterModel({ name: "UserModel" })
* export class User extends Model {
*   static table = "users";
* }
*
* // Later, retrieve by name:
* const UserModel = getModelFromRegistry("User");
* ```
*/
function RegisterModel(options) {
	return function(value, context) {
		if (context.kind !== "class") throw new Error(`@RegisterModel can only be applied to classes — got "${context.kind}".`);
		const modelName = options?.name || (context.name ?? value.name);
		if (!modelName) throw new Error("@RegisterModel decorator: Unable to determine model name. Please provide a name in options or ensure your class has a name.");
		if (modelsRegistry.has(modelName)) console.warn(`⚠️  Model "${modelName}" is already registered. This will overwrite the previous registration.`);
		const decoratorRelations = context.metadata?.[RELATION_METADATA_KEY];
		if (decoratorRelations && Object.keys(decoratorRelations).length > 0) value.relations = {
			...Object.prototype.hasOwnProperty.call(value, "relations") ? value.relations : { ...value.relations ?? {} },
			...decoratorRelations
		};
		modelsRegistry.set(modelName, value);
		return value;
	};
}
function registerModelInRegistry(name, model) {
	modelsRegistry.set(name, model);
}
/**
* Get a model class by its name from the global registry.
*
* @param name - The model class name
* @returns The model class or undefined if not found
*
* @example
* ```typescript
* const UserModel = getModelFromRegistry("User");
* if (UserModel) {
*   const user = await UserModel.find(1);
* }
* ```
*/
function getModelFromRegistry(name) {
	return modelsRegistry.get(name);
}
/**
* Get all registered models from the global registry.
*
* @returns A Map of all registered model classes by name
*
* @example
* ```typescript
* const allModels = getAllModelsFromRegistry();
* for (const [name, ModelClass] of allModels) {
*   console.log(`Found model: ${name}`);
* }
* ```
*/
function getAllModelsFromRegistry() {
	return new Map(modelsRegistry);
}
/**
* Clean up all models from register
*/
function cleanupModelsRegistery() {
	modelsRegistry.clear();
}
function removeModelFromRegistery(name) {
	modelsRegistry.delete(name);
}
function resolveModelClass(model) {
	if (typeof model === "string") return getModelFromRegistry(model);
	if (isLazy(model)) return model.resolve();
	return model;
}
/**
* Like `resolveModelClass`, but returns `undefined` instead of asserting
* a non-null result when a string ref isn't in the registry. Use this
* at call sites that already handle the missing-model case explicitly
* (e.g. join builders that throw their own contextual error).
*/
function tryResolveModelClass(model) {
	if (model === void 0) return void 0;
	if (typeof model === "string") return getModelFromRegistry(model);
	if (isLazy(model)) return model.resolve();
	return model;
}
/**
* Read the model's registered name from any `ModelRef`. Used by
* convention helpers (`inferPivotTable`, `inferPivotKey`) that derive
* table / column names from the related model's class name.
*
* For string refs the value passes through. For class and lazy refs
* the class's `.name` is returned — same string the registry would
* key the class under, so conventions stay consistent across ref shapes.
*/
function resolveModelName(model) {
	if (typeof model === "string") return model;
	if (isLazy(model)) return model.resolve().name;
	return model.name;
}
/**
* Walk every registered model and verify that every relation declared on it
* points at another registered model. Throws fast at boot with a clear error
* naming the unresolved target — much better signal than the runtime
* "Model not found" thrown deep inside a query.
*
* Call this once during app bootstrap, after every `@RegisterModel`-decorated
* model module has been imported.
*
* @returns The number of relations verified (success case)
* @throws Error listing every unresolved relation target if any are missing
*
* @example
* ```typescript
* // Inside your app bootstrap, after model imports:
* import { verifyRegisteredRelations } from "@warlock.js/cascade";
* verifyRegisteredRelations();
* ```
*/
function verifyRegisteredRelations() {
	const failures = [];
	let verifiedCount = 0;
	for (const [callerName, ModelClass] of modelsRegistry) {
		const relations = ModelClass.relations;
		if (!relations) continue;
		for (const [relationName, definition] of Object.entries(relations)) {
			verifiedCount++;
			const targetName = definition.model;
			if (typeof targetName !== "string") continue;
			if (!modelsRegistry.has(targetName)) failures.push({
				caller: callerName,
				relation: relationName,
				target: targetName
			});
		}
	}
	if (failures.length > 0) {
		const list = failures.map((f) => `  - ${f.caller}.${f.relation} → "${f.target}" is not registered`).join("\n");
		throw new Error(`verifyRegisteredRelations: ${failures.length} unresolved relation target(s):\n${list}\nEach target must be decorated with @RegisterModel() and imported before bootstrap.`);
	}
	return verifiedCount;
}
//#endregion
export { RegisterModel, cleanupModelsRegistery, getAllModelsFromRegistry, getModelFromRegistry, registerModelInRegistry, removeModelFromRegistery, resolveModelClass, resolveModelName, tryResolveModelClass, verifyRegisteredRelations };

//# sourceMappingURL=register-model.mjs.map
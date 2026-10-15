import { clone } from "@mongez/reinforcements";
import { DateValidator } from "@warlock.js/seal";
import { RelationHydrator, type ModelSnapshot, type SerializedRelation } from "../../relations/relation-hydrator";
import type { ChildModel, Model } from "../model";

/**
 * Drivers re-inflate any ISO-looking string into a Date. Only fields the model
 * schema declares as dates may be converted, so put every other string back.
 */
function restoreUndeclaredDateStrings<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  original: Record<string, string>,
  data: Record<string, unknown>,
): void {
  const shape = ModelClass.schema?.schema ?? {};

  for (const [key, value] of Object.entries(original)) {
    if (data[key] instanceof Date && !(shape[key] instanceof DateValidator)) {
      data[key] = value;
    }
  }
}

export function hydrateModel<TModel extends Model = Model>(
  ModelClass: ChildModel<TModel>,
  data: Record<string, unknown>,
): TModel {
  const strings: Record<string, string> = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") strings[key] = value;
  }

  const deserialized = ModelClass.getDriver().deserialize(data);
  restoreUndeclaredDateStrings(ModelClass, strings, deserialized);

  const model = new ModelClass(deserialized);
  model.isNew = false;
  return model;
}

export function modelFromSnapshot<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
  snapshot: ModelSnapshot,
): TModel {
  const model = ModelClass.hydrate(snapshot.data) as TModel;
  RelationHydrator.hydrate(model, ModelClass.relations, snapshot.relations);
  return model;
}

export function modelToSnapshot(model: Model): ModelSnapshot {
  const driver = (model.constructor as typeof Model).getDataSource().driver;
  const relations: Record<string, SerializedRelation> = {};

  for (const [name, related] of model.loadedRelations) {
    if (related === null) {
      relations[name] = null;
    } else if (Array.isArray(related)) {
      relations[name] = related.map((m) => (m instanceof Object && typeof m.toSnapshot === "function" ? m.toSnapshot() : m));
    } else if (related instanceof Object && typeof related.toSnapshot === "function") {
      relations[name] = related.toSnapshot();
    }
  }

  return {
    data: driver.serialize({ ...model.data }) as Record<string, unknown>,
    relations,
  };
}

export function serializeModel(model: Model) {
  return (model.constructor as typeof Model).getDataSource().driver.serialize(model.data);
}

export function cloneModel<TModel extends Model>(model: TModel): TModel {
  const clonedData = clone(model.data);
  const ModelClass = model.self();
  const clonedModel = new ModelClass(clonedData) as TModel;

  clonedModel.isNew = model.isNew;
  deepFreezeObject(clonedModel.data);
  clonedModel.dirtyTracker.reset();

  return clonedModel;
}

export function deepFreezeObject<T>(obj: T): T {
  Object.freeze(obj);

  Object.getOwnPropertyNames(obj).forEach((prop) => {
    const value = (obj as any)[prop];
    if (
      value !== null &&
      (typeof value === "object" || typeof value === "function") &&
      !Object.isFrozen(value)
    ) {
      deepFreezeObject(value);
    }
  });

  return obj;
}

export function replaceModelData<TModel extends Model>(
  model: TModel,
  data: Record<string, unknown>,
): void {
  model.data = data as any;
  model.dirtyTracker.replaceCurrentData(data);
}

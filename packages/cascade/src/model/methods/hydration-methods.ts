import { clone } from "@mongez/reinforcements";
import { DateValidator } from "@warlock.js/seal";
import {
  RelationHydrator,
  type ModelSnapshot,
  type SerializedRelation,
} from "../../relations/relation-hydrator";
import type { DriverContract } from "../../contracts";
import type { ChildModel, Model } from "../model";

/** Date column names a model class's schema declares, computed once per class. */
const declaredDateKeys = new WeakMap<object, ReadonlySet<string>>();

function getDeclaredDateKeys(ModelClass: ChildModel<Model>): ReadonlySet<string> {
  let keys = declaredDateKeys.get(ModelClass);

  if (!keys) {
    const shape = ModelClass.schema?.schema ?? {};

    keys = new Set(
      Object.keys(shape).filter(
        (key) => (shape as Record<string, unknown>)[key] instanceof DateValidator,
      ),
    );
    declaredDateKeys.set(ModelClass, keys);
  }

  return keys;
}

/**
 * Whether a raw string could be one the driver re-inflates into a Date: an
 * ISO timestamp or a date, so at least ten characters starting with a digit.
 */
function mayBecomeDate(value: string): boolean {
  if (value.length < 10) return false;

  const first = value.charCodeAt(0);

  return first >= 48 && first <= 57;
}

/**
 * The driver the next `new ModelClass(...)` of a hydration reuses, so the
 * constructor does not resolve the data source a second time for the same row.
 */
let hydrationDriver: { ModelClass: unknown; driver: DriverContract } | undefined;

/** Take the driver {@link hydrateModel} left for this model class, if any. */
export function takeHydrationDriver(ModelClass: unknown): DriverContract | undefined {
  const pending = hydrationDriver;

  if (pending && pending.ModelClass === ModelClass) {
    hydrationDriver = undefined;
    return pending.driver;
  }

  return undefined;
}

/**
 * Hydrate a model from a raw row.
 *
 * @param driver - The model's driver when the caller already resolved it (a
 * query builder hydrating a whole result set resolves it once); looked up from
 * the model's data source when omitted.
 */
export function hydrateModel<TModel extends Model = Model>(
  ModelClass: ChildModel<TModel>,
  data: Record<string, unknown>,
  driver: DriverContract = ModelClass.getDriver(),
): TModel {
  // Drivers re-inflate any ISO-looking string into a Date, in place. Only
  // fields the schema declares as dates may stay Dates, so keep the strings
  // that could have been converted and put them back afterwards.
  const dateKeys = getDeclaredDateKeys(ModelClass);
  let strings: Record<string, string> | undefined;

  for (const key in data) {
    const value = data[key];

    if (typeof value === "string" && !dateKeys.has(key) && mayBecomeDate(value)) {
      (strings ??= {})[key] = value;
    }
  }

  const deserialized = driver.deserialize(data);

  if (strings) {
    for (const key in strings) {
      if (deserialized[key] instanceof Date) {
        deserialized[key] = strings[key];
      }
    }
  }

  hydrationDriver = { ModelClass, driver };

  let model: TModel;

  try {
    model = new ModelClass(deserialized);
  } finally {
    hydrationDriver = undefined;
  }

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
      relations[name] = related.map((m) =>
        m instanceof Object && typeof m.toSnapshot === "function" ? m.toSnapshot() : m,
      );
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

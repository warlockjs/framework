import { clone } from "@mongez/reinforcements";
import {
  ArrayValidator,
  DateValidator,
  ObjectValidator,
  RecordValidator,
  TupleValidator,
} from "@warlock.js/seal";
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

/** Column names a model class's schema declares as objects, arrays, records or tuples. */
const declaredJsonKeys = new WeakMap<object, ReadonlySet<string>>();

function getDeclaredJsonKeys(ModelClass: ChildModel<Model>): ReadonlySet<string> {
  let keys = declaredJsonKeys.get(ModelClass);

  if (!keys) {
    const shape = (ModelClass.schema?.schema ?? {}) as Record<string, unknown>;

    keys = new Set(
      Object.keys(shape).filter((key) => {
        const validator = shape[key];

        return (
          validator instanceof ObjectValidator ||
          validator instanceof ArrayValidator ||
          validator instanceof RecordValidator ||
          validator instanceof TupleValidator
        );
      }),
    );
    declaredJsonKeys.set(ModelClass, keys);
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
  const data = { ...snapshot.data };

  // Columns that were Dates when the snapshot was taken.
  for (const key of snapshot.dates ?? []) {
    const value = data[key];

    if (typeof value === "string") {
      const date = new Date(value);

      if (!Number.isNaN(date.getTime())) data[key] = date;
    }
  }

  // Snapshots written before values were kept as plain JS hold object and
  // array columns as JSON text (PostgreSQL). A column the schema declares as
  // an object or array can never legitimately hold a string, so parse it back.
  const jsonKeys = getDeclaredJsonKeys(ModelClass);

  for (const key of jsonKeys) {
    const value = data[key];

    if (typeof value !== "string") continue;

    const first = value.charCodeAt(0);

    // '{' = 123, '[' = 91
    if (first !== 123 && first !== 91) continue;

    try {
      data[key] = JSON.parse(value);
    } catch {
      // Not JSON: leave the value as it was stored.
    }
  }

  const model = ModelClass.hydrate(data) as TModel;
  RelationHydrator.hydrate(model, ModelClass.relations, snapshot.relations);
  return model;
}

export function modelToSnapshot(model: Model): ModelSnapshot {
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

  // Snapshots keep plain JS values: the cache is not a database, so no driver
  // encoding (JSON text for objects and arrays) belongs in it. Only values a
  // cache cannot hold faithfully are converted: Dates become ISO strings (their
  // keys are listed in `dates` so they come back as Dates), bigints and
  // ObjectIds become strings.
  const data: Record<string, unknown> = {};
  const dates: string[] = [];

  for (const [key, value] of Object.entries(model.data)) {
    if (value === undefined) continue;

    if (value instanceof Date) {
      data[key] = value.toISOString();
      dates.push(key);
    } else if (typeof value === "bigint") {
      data[key] = value.toString();
    } else if (isObjectId(value)) {
      data[key] = value.toString();
    } else if (typeof value === "object" && value !== null) {
      data[key] = clone(value);
    } else {
      data[key] = value;
    }
  }

  const snapshot: ModelSnapshot = { data, relations };

  if (dates.length > 0) snapshot.dates = dates;

  return snapshot;
}

function isObjectId(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { _bsontype?: string })._bsontype === "ObjectId"
  );
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

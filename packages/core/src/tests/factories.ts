import type { ChildModel, Model, ModelSchema } from "@warlock.js/cascade";
import { DEFAULT_FAKE_NOW } from "./fakes/clock-fake";

/** A model's schema type. */
type SchemaOf<TModel extends Model> = TModel extends Model<infer TSchema> ? TSchema : ModelSchema;

/** The attributes a model is created from: a partial of its schema, as `Model.create()` takes. */
export type FactoryAttributes<TModel extends Model> = Partial<SchemaOf<TModel>>;

/**
 * Deterministic values for one record, derived only from its sequence number:
 * the n-th record a factory builds is the same on every run, with no faker
 * and no randomness.
 */
export type FactorySeed = {
  /** 1 for the first record this factory builds, 2 for the second, ... */
  readonly sequence: number;
  /** Position within the current `makeMany()` / `createMany()` call, from 0. */
  readonly index: number;
  /** `"<prefix> <sequence>"`, e.g. `text("Post")` → `"Post 3"`. */
  text(prefix?: string): string;
  /** `"<prefix><sequence>@example.test"`, e.g. `"user3@example.test"`. */
  email(prefix?: string): string;
  /** A valid v4-shaped UUID numbered by the sequence. */
  uuid(): string;
  /** 2026-01-01T00:00:00Z plus `offsetDays` days. */
  date(offsetDays?: number): Date;
  /** An integer in `[min, max]`, cycling with the sequence. */
  number(min?: number, max?: number): number;
  /** One of `values`, cycling with the sequence. */
  pick<T>(values: readonly T[]): T;
};

/** Overrides: a partial, or a function of the seed returning one. */
export type FactoryOverrides<TAttributes> =
  | Partial<TAttributes>
  | ((seed: FactorySeed) => Partial<TAttributes>);

/** A named variation, applied on top of the definition (and earlier states). */
export type FactoryState<TAttributes> = (
  seed: FactorySeed,
  attributes: TAttributes,
) => Partial<TAttributes>;

export type Factory<TModel extends Model, TAttributes = FactoryAttributes<TModel>> = {
  /** Build attributes without saving anything — no database needed. */
  make(overrides?: FactoryOverrides<TAttributes>): TAttributes;
  /** Build `count` attribute sets without saving anything. */
  makeMany(count: number, overrides?: FactoryOverrides<TAttributes>): TAttributes[];
  /** Create and save one record through `Model.create()`. */
  create(overrides?: FactoryOverrides<TAttributes>): Promise<TModel>;
  /** Create and save `count` records, one `Model.create()` each, in order. */
  create(count: number, overrides?: FactoryOverrides<TAttributes>): Promise<TModel[]>;
  /** Same as `create(count, overrides)`. */
  createMany(count: number, overrides?: FactoryOverrides<TAttributes>): Promise<TModel[]>;
  /** Register a named state on this factory; returns the factory for chaining. */
  state(name: string, state: FactoryState<TAttributes>): Factory<TModel, TAttributes>;
  /** A factory that applies the named states, in order, on top of the definition. */
  with(...states: string[]): Factory<TModel, TAttributes>;
  /** Restart this factory's sequence at 1. */
  resetSequence(): void;
};

type SequenceCounter = { value: number };

const counters = new Set<SequenceCounter>();

/** Restart every factory's sequence, e.g. in `beforeEach`. */
export function resetFactorySequences(): void {
  for (const counter of counters) counter.value = 0;
}

function createSeed(sequence: number, index: number): FactorySeed {
  return {
    sequence,
    index,
    text: (prefix = "Text") => `${prefix} ${sequence}`,
    email: (prefix = "user") => `${prefix}${sequence}@example.test`,
    uuid: () => `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    date: (offsetDays = 0) => new Date(DEFAULT_FAKE_NOW + offsetDays * 86_400_000),
    number: (min = 1, max = 1000) => {
      if (max < min) throw new RangeError(`seed.number(${min}, ${max}): max is below min.`);

      return min + ((sequence - 1) % (max - min + 1));
    },
    pick: <T>(values: readonly T[]): T => {
      const value = values[(sequence - 1) % values.length];

      if (value === undefined) throw new RangeError("seed.pick() needs at least one value.");

      return value;
    },
  };
}

function buildFactory<TModel extends Model>(
  model: ChildModel<TModel>,
  definition: (seed: FactorySeed) => FactoryAttributes<TModel>,
  counter: SequenceCounter,
  states: Map<string, FactoryState<FactoryAttributes<TModel>>>,
  applied: readonly string[],
): Factory<TModel> {
  type TAttributes = FactoryAttributes<TModel>;

  const build = (index: number, overrides?: FactoryOverrides<TAttributes>): TAttributes => {
    counter.value += 1;

    const seed = createSeed(counter.value, index);
    let attributes: TAttributes = { ...definition(seed) };

    for (const name of applied) {
      const state = states.get(name);

      if (!state) {
        throw new Error(
          `Factory state "${name}" is not defined. Defined states: ${[...states.keys()].join(", ") || "(none)"}.`,
        );
      }

      attributes = { ...attributes, ...state(seed, attributes) };
    }

    const extra = typeof overrides === "function" ? overrides(seed) : overrides;

    return { ...attributes, ...extra };
  };

  const assertCount = (count: number): void => {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`A factory count must be a non-negative integer, got ${String(count)}.`);
    }
  };

  const persist = (attributes: TAttributes): Promise<TModel> => model.create(attributes);

  const createMany = async (
    count: number,
    overrides?: FactoryOverrides<TAttributes>,
  ): Promise<TModel[]> => {
    assertCount(count);

    const records: TModel[] = [];

    for (let index = 0; index < count; index++) {
      records.push(await persist(build(index, overrides)));
    }

    return records;
  };

  function create(overrides?: FactoryOverrides<TAttributes>): Promise<TModel>;
  function create(count: number, overrides?: FactoryOverrides<TAttributes>): Promise<TModel[]>;
  function create(
    countOrOverrides?: number | FactoryOverrides<TAttributes>,
    overrides?: FactoryOverrides<TAttributes>,
  ): Promise<TModel | TModel[]> {
    if (typeof countOrOverrides === "number") return createMany(countOrOverrides, overrides);

    return persist(build(0, countOrOverrides));
  }

  const factory: Factory<TModel> = {
    make: (overrides) => build(0, overrides),
    makeMany: (count, overrides) => {
      assertCount(count);

      return Array.from({ length: count }, (_, index) => build(index, overrides));
    },
    create,
    createMany,
    state: (name, state) => {
      states.set(name, state);

      return factory;
    },
    with: (...names) => buildFactory(model, definition, counter, states, [...applied, ...names]),
    resetSequence: () => {
      counter.value = 0;
    },
  };

  return factory;
}

/**
 * Define a model factory: deterministic attributes for tests and seeders.
 *
 * `make()` builds attributes only (no database), `create()` saves through the
 * model's own `create()`, so casts, defaults, hooks and events all run.
 *
 * @example
 * export const userFactory = defineFactory(User, (seed) => ({
 *   name: seed.text("User"),
 *   email: seed.email(),
 *   password: "test-password",
 * })).state("admin", () => ({ role: "admin" }));
 *
 * const body = userFactory.make({ name: "Ada" });   // { name: "Ada", email: "user1@example.test", ... }
 * const admin = await userFactory.with("admin").create();
 * const users = await userFactory.create(3);
 */
export function defineFactory<TModel extends Model>(
  model: ChildModel<TModel>,
  definition: (seed: FactorySeed) => FactoryAttributes<TModel>,
): Factory<TModel> {
  const counter: SequenceCounter = { value: 0 };

  counters.add(counter);

  return buildFactory<TModel>(model, definition, counter, new Map(), []);
}

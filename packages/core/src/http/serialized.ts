import type { Model } from "@warlock.js/cascade";

/**
 * The two wire formats Warlock serializes a value into.
 *
 * - `"json"`: an API response. `Response.parse` walks the value, then the body
 *   is `JSON.stringify`-ed. `Date` becomes a string, `Map` an object, `Set` an
 *   array.
 * - `"devalue"`: page loader data. `serializeLoaderData` walks the value, then
 *   `devalue` encodes it. `Date`, `Map`, `Set`, `RegExp` and `URL` survive as
 *   native values.
 */
export type SerializedWire = "json" | "devalue";

/**
 * Maps cascade models to the resource that serializes them.
 *
 * Empty on purpose: `Model.resource` is a static typed `any`, so a model
 * instance type cannot reveal its resource. A code generator (or the app)
 * augments this interface instead, one entry per model:
 *
 * @example
 * declare module "@warlock.js/core" {
 *   interface ModelResourceRegistry {
 *     User: { model: User; resource: typeof UserResource };
 *   }
 * }
 *
 * `Serialized<User>` then resolves to the output of `UserResource`. A model
 * with no entry resolves to its serialized `data` type instead.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ModelResourceRegistry {}

/** Deepest level `Serialized` walks before giving up with `unknown`. */
type MaxSerializedDepth = 8;

type IsAny<T> = 0 extends 1 & T ? true : false;

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/** Passes through untouched on both wires (`Buffer` has a `toJSON`, so it must be caught first). */
type Binary = Buffer | Uint8Array;

/** Returned whole by `serializeLoaderData` before `toJSON` is considered. */
type DevalueNative = Date | RegExp | URL | Map<any, any> | Set<any>;

/**
 * Built-in classes that are not plain objects and have no `toJSON`. JSON emits
 * `{}` for them (their state is not enumerable); devalue cannot encode them.
 */
type OpaqueBuiltin = Error | WeakMap<any, any> | WeakSet<any> | WeakRef<any>;

type IsFunctionValued<V> =
  IsAny<V> extends true
    ? false
    : [Exclude<V, undefined>] extends [never]
      ? false
      : [Exclude<V, undefined>] extends [(...args: any[]) => any]
        ? true
        : false;

type IsUndefinable<V> =
  IsAny<V> extends true ? false : unknown extends V ? false : undefined extends V ? true : false;

/** Keys whose value is not a function: functions are dropped by JSON and by the key-removal rule. */
type DataKeys<T> = {
  [K in keyof T]-?: IsFunctionValued<T[K]> extends true ? never : K;
}[keyof T];

/** Keys that JSON omits when their value is `undefined`, so they become optional on the json wire. */
type UndefinableKeys<T> = {
  [K in keyof T]-?: K extends DataKeys<T> ? (IsUndefinable<T[K]> extends true ? K : never) : never;
}[keyof T];

type Flatten<T> = { [K in keyof T]: T[K] };

/**
 * Whether `T` has members a mapped copy cannot carry (private, protected or
 * `#private`). Only such a class is detectable as a class at the type level; a
 * class with public members only is structurally an interface, so it is treated
 * as a plain object. Mapping `keyof T` drops the non-public members, which makes
 * the copy unassignable back to `T`.
 */
type HasNonPublicMembers<T> = { [K in keyof T]: T[K] } extends T ? false : true;

/** Resource registered for the model type `T`, or `never` when `T` has no entry. */
type RegisteredResource<T> = {
  [K in keyof ModelResourceRegistry]: ModelResourceRegistry[K] extends {
    model: infer M;
    resource: infer R;
  }
    ? [T] extends [M]
      ? [M] extends [T]
        ? R
        : never
      : never
    : never;
}[keyof ModelResourceRegistry];

/** What a resource class emits from `toJSON()`, serialized for the wire. */
type SerializedResource<R, W extends SerializedWire, D extends unknown[]> = R extends new (
  ...args: any[]
) => { toJSON(): infer O }
  ? Serialized<O, W, D>
  : unknown;

type SerializedModel<T, W extends SerializedWire, D extends unknown[]> = [
  RegisteredResource<T>,
] extends [never]
  ? T extends { data: infer Data }
    ? Serialized<Data, W, [...D, 0]>
    : never
  : SerializedResource<RegisteredResource<T>, W, [...D, 0]>;

type SerializedJsonObject<T, D extends unknown[]> = Flatten<
  {
    [K in keyof T as K extends Exclude<DataKeys<T>, UndefinableKeys<T>> ? K : never]-?: Serialized<
      T[K],
      "json",
      [...D, 0]
    >;
  } & {
    [K in keyof T as K extends UndefinableKeys<T> ? K : never]+?: Serialized<
      Exclude<T[K], undefined>,
      "json",
      [...D, 0]
    >;
  }
>;

type SerializedDevalueObject<T, D extends unknown[]> = {
  -readonly [K in keyof T as K extends DataKeys<T> ? K : never]: Serialized<
    T[K],
    "devalue",
    [...D, 0]
  >;
};

type SerializedObject<T, W extends SerializedWire, D extends unknown[]> = W extends "json"
  ? SerializedJsonObject<T, D>
  : SerializedDevalueObject<T, D>;

/**
 * The type of what a client receives after Warlock serializes a value of type
 * `T`. It mirrors `Response.parse` (`"json"`, the default) and
 * `serializeLoaderData` (`"devalue"`), branch for branch and in the same order:
 *
 * 1. `any` stays `any`; `unknown` stays `unknown`; primitives pass through.
 * 2. `Buffer` / `Uint8Array` pass through on both wires.
 * 3. devalue: `Date`, `RegExp`, `URL`, `Map`, `Set` stay native.
 *    json: `Map<K, V>` becomes `Record<K, V'>`.
 * 4. A cascade `Model`: the output of its registered resource (see
 *    {@link ModelResourceRegistry}), else its serialized `data` type.
 * 5. Anything with `toJSON()`: the serialized (awaited) result. This is where a
 *    `Date` becomes a `string` on json.
 * 6. Arrays and tuples map item by item; other iterables (a `Set` on json,
 *    generators) become arrays.
 * 7. Functions are removed from objects (and are `never` on their own).
 * 8. Objects are mapped key by key. On json a key whose value can be
 *    `undefined` becomes optional, because `JSON.stringify` omits it.
 *
 * Plain object vs class instance cannot be decided by the type system in
 * general. The rule used: only a class with non-public (private, protected or
 * `#private`) members, or a built-in such as `Error`, is treated as a class
 * instance without `toJSON`. It maps to its public data properties on json
 * (`Error` to `{}`) and to `never` on devalue, where devalue throws at render
 * time. Any other object type is treated as plain.
 *
 * Nesting is walked up to a fixed depth, then the result is `unknown`.
 *
 * @example
 * type UserPayload = Serialized<User>; // resource output or serialized data
 * type PageData = Serialized<LoaderReturn, "devalue">;
 */
export type Serialized<
  T,
  W extends SerializedWire = "json",
  D extends unknown[] = [],
> = IsAny<T> extends true
  ? any
  : unknown extends T
    ? unknown
    : D["length"] extends MaxSerializedDepth
      ? unknown
      : T extends Primitive
        ? T
        : T extends Binary
          ? T
          : W extends "devalue"
            ? T extends DevalueNative
              ? T
              : SerializedStructure<T, W, D>
            : T extends Map<infer K, infer V>
              ? Record<Extract<K, PropertyKey>, Serialized<V, W, D>>
              : SerializedStructure<T, W, D>;

type SerializedStructure<T, W extends SerializedWire, D extends unknown[]> = T extends Model<any>
  ? SerializedModel<T, W, D>
  : T extends { toJSON(...args: any[]): infer R }
    ? Serialized<Awaited<R>, W, [...D, 0]>
    : T extends readonly unknown[]
      ? { -readonly [K in keyof T]: Serialized<T[K], W, D> }
      : T extends Iterable<infer I>
        ? Serialized<I, W, D>[]
        : T extends (...args: any[]) => any
          ? never
          : T extends OpaqueBuiltin
            ? W extends "json"
              ? {}
              : never
            : HasNonPublicMembers<T> extends true
              ? W extends "json"
                ? SerializedObject<T, W, D>
                : never
              : SerializedObject<T, W, D>;

import { type Lazy } from "@mongez/reinforcements";
import { type ResourceConstructor } from "./resource";

/**
 * Brand of a nullable resource marker. `Symbol.for` keeps it identical across duplicated
 * copies of this module (the dev server, the typings child process and the app all load one).
 */
export const NULLABLE_RESOURCE = Symbol.for("warlock.resource.nullable");

/**
 * What `nullable()` accepts: a resource class, or a lazy reference to one (for cyclic resources).
 */
export type NullableResourceTarget = ResourceConstructor<any> | Lazy<ResourceConstructor<any>>;

/**
 * Marker returned by `nullable(Resource)`.
 */
export interface NullableResource<R extends NullableResourceTarget = NullableResourceTarget> {
  readonly [NULLABLE_RESOURCE]: true;
  readonly resource: R;
}

/**
 * Declare a nested resource that is always present in the output: the resource's output when
 * there is a value, `null` when the input is `null` or `undefined` (the field is not omitted).
 *
 * Accepted wherever a resource is accepted: as a `defineResource` schema field and as a value in
 * a `responseSchema` body (including nested objects).
 *
 * @example
 * ```typescript
 * const PostResource = defineResource({
 *   schema: { id: "number", author: nullable(UserResource) },
 * });
 *
 * // ResourceOutput<typeof PostResource> -> { id: number; author: UserJson | null }
 * ```
 */
export function nullable<R extends NullableResourceTarget>(resource: R): NullableResource<R> {
  return { [NULLABLE_RESOURCE]: true, resource };
}

/**
 * True when the value is a marker created by `nullable()`.
 */
export function isNullableResource(value: unknown): value is NullableResource {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[NULLABLE_RESOURCE] === true
  );
}

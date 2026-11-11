/**
 * Clone non-primitive values so cached state can't be mutated through
 * references held by callers. Primitives are immutable and returned as-is.
 *
 * @internal Shared by the in-process drivers; not part of the public API.
 */
export function cloneValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  const type = typeof value;

  if (type === "string" || type === "number" || type === "boolean") {
    return value;
  }

  return structuredClone(value);
}

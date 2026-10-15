import { stringify as safeStableStringify } from "safe-stable-stringify";

/**
 * Replacer that surfaces Error data — `name`, `message`, and `stack` are
 * non-enumerable on `Error`, so neither default JSON serialization nor an
 * object spread captures them (both produce `{}`). They are copied explicitly;
 * the trailing spread then captures any additional enumerable props the caller
 * (or a subclass) attached, such as a `code` field.
 */
function errorReplacer<Value = unknown>(
  _key: string,
  value: Value,
): Record<string, unknown> | Value {
  if (value instanceof Error) {
    // Spread first, then the explicit Error fields. `name`/`message`/`stack`
    // are non-enumerable on `Error`, so the spread never carries them — the
    // explicit assignments are what surface them. Placing the spread first
    // means those explicit keys legitimately take precedence over any
    // identically-named *enumerable* prop a subclass attached (resolving the
    // duplicate-key warning). Because `safe-stable-stringify` sorts keys, the
    // insertion order here does not affect the serialized bytes.
    return {
      ...value,
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  return value;
}

/**
 * JSON-serialize log payloads safely. Circular refs, BigInt, and repeated
 * non-tree references are handled by `safe-stable-stringify`; functions and
 * symbols are dropped (standard JSON behavior); Errors are expanded via
 * `errorReplacer`. Class instances serialize as their enumerable props.
 *
 * @example
 * await fs.promises.writeFile(filePath, safeJsonStringify(payload, 2));
 */
export function safeJsonStringify(value: unknown, space?: number): string {
  return safeStableStringify(value, errorReplacer, space) ?? "";
}

import { trim } from "@mongez/reinforcements";
import { isPlainObject } from "@mongez/supportive-is";
import { isForbiddenKey, resolveSealLimit } from "../helpers/limits";
import type { Mutator, MutatorContext } from "../types";

/**
 * Write `value` as an own property. A `__proto__` key stays an inert own key
 * (so the unknown-key rule still sees and rejects it) instead of replacing
 * the result's prototype.
 */
function setOwn(target: Record<string, any>, key: string, value: unknown) {
  if (isForbiddenKey(key)) {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    target[key] = value;
  }
}

/** Strip unknown keys from object */
export const stripUnknownMutator: Mutator = async (value, context) => {
  const allowedKeys = [
    ...(context?.ctx.schema ? Object.keys(context.ctx.schema) : []),
    ...(context?.options.allowedKeys ?? []),
  ];

  const result: Record<string, any> = {};

  for (const key in value) {
    if (allowedKeys.includes(key) && !isForbiddenKey(key)) {
      result[key] = value[key];
    }
  }

  return result;
};

/** Trim all string values in object */
export const objectTrimMutator: Mutator = async (value, context) => {
  return trimObject(value, context, resolveSealLimit(context?.ctx, "maxDepth"), 0);
};

/**
 * Trim the strings of a plain object. Recursion stops at `maxDepth` levels:
 * deeper values are kept as they are, and the object's own depth check
 * reports them.
 */
async function trimObject(
  value: any,
  context: MutatorContext | undefined,
  maxDepth: number,
  depth: number,
): Promise<any> {
  if (!isPlainObject(value)) return value;

  const result: Record<string, any> = {};
  const recursive = (context?.options.recursive ?? false) && depth < maxDepth;

  for (const key in value) {
    const item = value[key];

    if (recursive) {
      if (Array.isArray(item)) {
        setOwn(
          result,
          key,
          await Promise.all(
            item.map(async (i: any) =>
              typeof i === "string" ? trim(i) : await trimObject(i, context, maxDepth, depth + 1),
            ),
          ),
        );
      } else if (isPlainObject(item)) {
        setOwn(result, key, await trimObject(item, context, maxDepth, depth + 1));
      } else {
        setOwn(result, key, typeof item === "string" ? trim(item) : item);
      }
    } else {
      setOwn(result, key, typeof item === "string" ? trim(item) : item);
    }
  }

  return result;
}

/** Parse JSON string */
export const jsonMutator: Mutator = async (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

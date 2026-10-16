import { InvalidRequestError, type ModelCallOptions } from "@warlock.js/ai";

/** Adapter-only fields merged after the neutral request parameters. */
export type GoogleCallOptions = { body?: Record<string, unknown> };

const RESERVED_FIELDS = new Set(["systemInstruction", "tools", "abortSignal", "httpOptions"]);

export function mergeProviderBody<T extends object>(
  built: T,
  options: ModelCallOptions | undefined,
): T {
  const provider = options?.providerOptions?.google as GoogleCallOptions | undefined;
  const body = provider?.body ?? {};
  const reserved = Object.keys(body).filter((key) => RESERVED_FIELDS.has(key));
  if (reserved.length > 0) {
    throw new InvalidRequestError(
      `providerOptions.google.body cannot set ${reserved.join(", ")}: use the call's messages, tools and model options.`,
      { context: { fields: reserved } },
    );
  }
  const defaults = built as Record<string, unknown>;
  const overrides = Object.fromEntries(
    Object.entries(body).map(([key, value]) => {
      const previous = defaults[key];
      return [
        key,
        isPlainObject(previous) && isPlainObject(value) ? { ...previous, ...value } : value,
      ];
    }),
  );
  return { ...built, ...overrides };
}

/** Merge only plain objects; arrays, null and provider scalar values replace the field. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Size, error-count and nesting limits shared by the container validators.
 *
 * Kept out of the helpers barrel: these are internal to the validators. The
 * public surface is the `configureSeal()` options and `RecordValidator#maxKeys()`.
 */
import { getSealConfig } from "../config";
import type { SchemaContext, SchemaRule } from "../types";
import { invalidRule, VALID_RULE } from "./validation-helpers";

export type SealLimitName = "maxArrayItems" | "maxRecordKeys" | "maxErrors" | "maxDepth";

/**
 * Resolve a limit for this validation call: the per-call `validate()` options
 * win over `configureSeal()`. A missing or invalid value means "no limit".
 */
export function resolveSealLimit(context: SchemaContext | undefined, name: SealLimitName): number {
  const value = context?.configurations?.[name] ?? getSealConfig()[name];

  return typeof value === "number" && value >= 0 ? value : Infinity;
}

/** Keys that turn into prototype writes when copied with plain assignment */
export function isForbiddenKey(key: string): boolean {
  return key === "__proto__";
}

/**
 * Array item cap applied when the schema sets no explicit length limit
 */
export const maxItemsRule: SchemaRule<{ maxItems: number }> = {
  name: "maxItems",
  defaultErrorMessage: "The :input must not contain more than :maxItems items",
  async validate(value: any, context) {
    if (!Array.isArray(value) || value.length <= this.context.options.maxItems) {
      return VALID_RULE;
    }

    this.context.translationParams.maxItems = this.context.options.maxItems;

    return invalidRule(this, context);
  },
};

/**
 * Record key cap (`v.record(...).maxKeys(n)`, or the `maxRecordKeys` default)
 */
export const maxKeysRule: SchemaRule<{ maxKeys: number }> = {
  name: "maxKeys",
  defaultErrorMessage: "The :input must not contain more than :maxKeys keys",
  async validate(value: any, context) {
    if (value === null || typeof value !== "object") return VALID_RULE;

    if (Object.keys(value).length <= this.context.options.maxKeys) return VALID_RULE;

    this.context.translationParams.maxKeys = this.context.options.maxKeys;

    return invalidRule(this, context);
  },
};

/**
 * Refuses keys that would replace an object's prototype (`__proto__`)
 */
export const forbiddenKeyRule: SchemaRule = {
  name: "forbiddenKey",
  defaultErrorMessage: "The :input contains a forbidden key: :forbiddenKey",
  async validate(value: any, context) {
    if (value === null || typeof value !== "object") return VALID_RULE;

    for (const key of Object.keys(value)) {
      if (isForbiddenKey(key)) {
        this.context.translationParams.forbiddenKey = key;

        return invalidRule(this, context);
      }
    }

    return VALID_RULE;
  },
};

/**
 * Nesting cap for an object's validated output
 */
export const maxDepthRule: SchemaRule<{ maxDepth: number }> = {
  name: "maxDepth",
  defaultErrorMessage: "The :input is nested too deeply (more than :maxDepth levels)",
  async validate(_value: any, context) {
    this.context.translationParams.maxDepth = this.context.options.maxDepth;

    return invalidRule(this, context);
  },
};

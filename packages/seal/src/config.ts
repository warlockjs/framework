/**
 * Seal Configuration
 *
 * Global configuration for the Seal validation library
 */

import type { AttributeTranslation, RuleTranslation } from "./types";

export type TranslateRuleCallback = (ruleTranslation: RuleTranslation) => string;

export type TranslateAttributeCallback = (attributeTranslation: AttributeTranslation) => string;

export type SealConfig = {
  /**
   * Translation function for error messages
   * Default: returns the key with attributes replaced
   */
  translateRule?: TranslateRuleCallback;
  /**
   * Translation function for attribute messages
   */
  translateAttribute?: TranslateAttributeCallback;
  /**
   * Translates a rule's `errorMessage` when it is a translation key such as
   * `admin.uploadUnrecognisedMedia` (dotted, no spaces). Return the key
   * unchanged, or an empty string, when it has no translation: the message
   * then stays as given. A message that is not key-shaped is never passed here.
   */
  translateMessageKey?: (key: string, attributes: RuleTranslation["attributes"]) => string;

  /**
   * Default to first error only in validation
   * Default: true
   */
  firstErrorOnly?: boolean;

  /**
   * Most items an array may hold when its schema sets no `.max()`, `.length()`
   * or `.between()`. A longer array fails with a `maxItems` error before any
   * item is validated. Set `Infinity` to lift the cap.
   * Default: 10000
   */
  maxArrayItems?: number;

  /**
   * Most keys a record may hold when its schema sets no `.maxKeys()`. A larger
   * record fails with a `maxKeys` error before any value is validated. Set
   * `Infinity` to lift the cap.
   * Default: 10000
   */
  maxRecordKeys?: number;

  /**
   * Most errors one array or record collects from its items. Once reached, the
   * remaining items are not validated and the error list is cut to this length.
   * Default: 100
   */
  maxErrors?: number;

  /**
   * Deepest nesting allowed inside an object's validated output (values passed
   * through `v.any()`, `.allowUnknown()` and the like), counted from that
   * object. Deeper data fails with a `maxDepth` error instead of exhausting the
   * call stack.
   * Default: 256
   */
  maxDepth?: number;
};

/**
 * Default values of the limit options
 */
const SEAL_LIMIT_DEFAULTS = {
  maxArrayItems: 10_000,
  maxRecordKeys: 10_000,
  maxErrors: 100,
  maxDepth: 256,
} as const;

/**
 * Global Seal configuration
 */
const config: SealConfig = {
  firstErrorOnly: true,
  ...SEAL_LIMIT_DEFAULTS,
};

/**
 * Configure Seal globally
 *
 * @example
 * ```ts
 * import { configureSeal } from "@warlock.js/seal";
 * import { trans } from "@mongez/localization";
 *
 * configureSeal({
 *   translateRule: (ruleTranslation) => trans(`validation.${ruleTranslation.rule.name}`, ruleTranslation.attributes),
 *   translateAttribute: (attributeTranslation) => trans(`validation.attributes.${attributeTranslation.rule.name}.${attributeTranslation.attribute}`, attributeTranslation.context.allValues),
 * });
 * ```
 */
export function configureSeal(options: Partial<SealConfig>): void {
  Object.assign(config, options);
}

/**
 * Get current Seal configuration
 */
export function getSealConfig(): SealConfig {
  return config;
}

/**
 * Reset configuration to defaults
 */
export function resetSealConfig(): void {
  delete config.translateRule;
  delete config.translateAttribute;
  delete config.translateMessageKey;

  config.firstErrorOnly = true;
  Object.assign(config, SEAL_LIMIT_DEFAULTS);
}

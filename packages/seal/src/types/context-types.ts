import type { SchemaRule } from "./rule-types";
import type { Schema } from "./schema-types";

export type RuleTranslation = {
  rule: SchemaRule;
  context: SchemaContext;
  attributes: {
    input: string;
    path: string;
    key: string;
    value: any;
    [key: string]: any;
  };
};

export type AttributeTranslation = {
  attribute: string;
  context: SchemaContext;
  rule: SchemaRule;
};

/**
 * Validation context passed to validators and rules
 */
export type SchemaContext = {
  /** All input values */
  allValues: any;
  /** Parent object if nested */
  parent: any;
  /** Current value being validated */
  value: any;
  /** Current key */
  key: string;
  /** Full path to the current value */
  path: string;
  /** Schema definition if object validator */
  schema?: Schema;
  /** Additional context */
  context?: Record<string, any>;
  /** Root context */
  rootContext?: Record<string, any>;
  /** Translation function for error messages */
  translateRule: (ruleTranslation: RuleTranslation) => string;
  translateAttribute: (attributeTranslation: AttributeTranslation) => string;
  /**
   * Set by a parent `ObjectValidator` when the key was absent and `value` is
   * this field's own `.default()`. The receiving validator reads it once and
   * clears it, so it never leaks into an array/tuple/record's item contexts.
   */
  valueIsDefault?: boolean;
  /** Validation configurations */
  configurations?: {
    firstErrorOnly?: boolean;
    /** Rendered as `:value` in error messages instead of the submitted input */
    redactValue?: string;
    /** Item cap for arrays without an explicit `.max()` (see `configureSeal`) */
    maxArrayItems?: number;
    /** Key cap for records without an explicit `.maxKeys()` (see `configureSeal`) */
    maxRecordKeys?: number;
    /** Most errors one array or record collects (see `configureSeal`) */
    maxErrors?: number;
    /** Deepest nesting allowed inside an object's output (see `configureSeal`) */
    maxDepth?: number;
  };
};

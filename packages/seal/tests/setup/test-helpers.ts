import { clone } from "@mongez/reinforcements";
import type {
  ContextualSchemaRule,
  RuleResult,
  SchemaContext,
  SchemaRule,
  SchemaRuleOptions,
  ValidationResult,
} from "../../src/types";

/**
 * Helper function to create a basic validation context
 */
export function createMockContext(
  allValues: Record<string, any> = {},
  value: any = undefined,
): SchemaContext {
  return {
    allValues: allValues || (value !== undefined ? { value } : {}),
    parent: null,
    value: value,
    key: "",
    path: "",
    translateRule: (ruleTranslation: any) => ruleTranslation || "",
    translateAttribute: (attributeTranslation: any) =>
      attributeTranslation || "",
    configurations: {},
  };
}

/**
 * Assert that validation result is valid (handles both RuleResult and ValidationResult)
 */
export function expectValid(result: ValidationResult | RuleResult) {
  if (!result.isValid) {
    if ("errors" in result && result.errors) {
      // ValidationResult
      const errors = result.errors.map(e => e.error).join(", ");
      throw new Error(`Expected validation to pass, but got errors: ${errors}`);
    } else if ("error" in result) {
      // RuleResult
      throw new Error(
        `Expected validation to pass, but got error: ${result.error}`,
      );
    } else {
      throw new Error(`Expected validation to pass, but it failed`);
    }
  }
}

/**
 * Assert that validation result is invalid (handles both RuleResult and ValidationResult)
 */
export function expectInvalid(
  result: ValidationResult | RuleResult,
  expectedError?: string,
) {
  if (result.isValid) {
    throw new Error("Expected validation to fail, but it passed");
  }

  if (expectedError) {
    let errorMessage = "";
    if ("errors" in result && result.errors) {
      // ValidationResult
      errorMessage = result.errors.map(e => String(e.error || "")).join(", ");
    } else if ("error" in result && result.error) {
      // RuleResult - error might be a string or object, convert properly
      const error = result.error;
      if (typeof error === "string") {
        errorMessage = error;
      } else if (error && typeof error === "object") {
        // If it's an object, try to get a meaningful string representation
        errorMessage = JSON.stringify(error);
      } else {
        errorMessage = String(error);
      }
    }

    if (
      errorMessage &&
      typeof errorMessage === "string" &&
      !errorMessage.includes(expectedError)
    ) {
      throw new Error(
        `Expected error message to contain "${expectedError}", but got: ${errorMessage}`,
      );
    }
  }
}

/**
 * Get error messages from validation result
 */
export function getErrorMessages(result: ValidationResult): string[] {
  return result.errors?.map(e => e.error) || [];
}

/**
 * Get error message from rule result
 */
export function getRuleError(result: RuleResult): string {
  if (result.isValid) {
    return "";
  }
  return result.error || "";
}

/**
 * Create a contextual rule from a schema rule (mimics BaseValidator.addRule exactly)
 *
 * Pattern from addRule():
 * 1. Clone the rule
 * 2. Create context with empty options typed as T: `options: {} as T`
 * 3. Then populate options (done by caller or via parameter)
 *
 * This ensures 'this' context is properly typed as ContextualSchemaRule<T>
 * in the rule's validate function.
 */
export function createContextualRule<
  T extends SchemaRuleOptions = SchemaRuleOptions,
>(
  rule: SchemaRule<T>,
  options?: Partial<T>,
  errorMessage?: string,
): ContextualSchemaRule<T> {
  // Clone the rule exactly like addRule() does
  const clonedRule = clone(rule) as unknown as ContextualSchemaRule<T>;

  // Create contextual rule with empty options (matching addRule pattern)
  const contextualRule: ContextualSchemaRule<T> = {
    ...clonedRule,
    context: {
      errorMessage,
      options: (options || {}) as T, // Use provided options or empty object
      attributesList: {},
    },
  } as ContextualSchemaRule<T>;

  // Set errorMessage on rule if provided (matching addRule behavior)
  if (errorMessage) {
    contextualRule.errorMessage = errorMessage;
  }

  return contextualRule;
}

/**
 * Simplified helper to validate a rule with minimal boilerplate
 *
 * @example
 * ```ts
 * const result = await mockValidateRule(equalRule, "hello", { value: "hello" });
 * expectValid(result);
 * ```
 */
export async function mockValidateRule<
  Options extends SchemaRuleOptions = SchemaRuleOptions,
>(
  rule: SchemaRule<Options>,
  value: any,
  options: Partial<Options> = {},
  contextOverrides?: {
    allValues?: any;
    path?: string;
    key?: string;
  },
): Promise<RuleResult> {
  const contextualRule = createContextualRule(rule, options);
  const context = createMockContext(value, contextOverrides?.allValues);

  // Apply context overrides if provided
  if (contextOverrides?.path !== undefined) {
    context.path = contextOverrides.path;
  }
  if (contextOverrides?.key !== undefined) {
    context.key = contextOverrides.key;
  }

  return contextualRule.validate(value, context);
}

import { type Aggregate } from "@warlock.js/cascade";
import { type BaseValidator } from "./schema";

export type Schema = Record<string, BaseValidator>;

export type SchemaContext = {
  allValues: any;
  parent: any;
  value: any;
  key: string;
  path: string;
  schema?: Schema;
  translator: (rule: string, options?: any) => string;
  configurations?: {
    firstErrorOnly: boolean;
  };
};

export type MutatorContext = {
  options: any;
  ctx: SchemaContext;
};

export type Mutator = (data: any, context: MutatorContext) => Promise<any>;

export type ContextualizedMutator = {
  mutate: Mutator;
  context: {
    options: any;
    // Global Context
    ctx: SchemaContext;
  };
};

export type RuleResult =
  | {
      isValid: false;
      error: string;
      input: string;
      path: string;
    }
  | {
      isValid: true;
    };

export type SchemaRuleOptions<T = any> = Record<string, T>;

export type ContextualSchemaRule<
  Options extends SchemaRuleOptions = SchemaRuleOptions,
> = SchemaRule & {
  /**
   * The context object is used to pass additional information to the rule
   * This will be always overridden when the rule is injected into a validator
   */
  context: {
    errorMessage?: string;
    options: Options;
  };
};

export type SchemaRule<Options extends SchemaRuleOptions = SchemaRuleOptions> =
  {
    name: string;
    description?: string;
    requiresValue?: boolean;
    validate: (
      this: ContextualSchemaRule<Options>,
      value: any,
      context: SchemaContext,
    ) => Promise<RuleResult>;
    defaultErrorMessage?: string;
    errorMessage?: string;
    sortOrder?: number;
  };

export type ValidationResult = {
  isValid: boolean;
  data: any;
  errors: {
    type: string;
    error: string;
    input: string;
  }[];
};

export type UniqueRuleOptions = {
  query?: (options: {
    query: Aggregate;
    value: any;
    allValues: any;
  }) => void | Promise<void>;
  except?: string;
  column?: string;
  exceptColumnName?: string;
  exceptValue?: any;
};

export type WhenRuleOptions = {
  field: string;
  is: Record<string, BaseValidator>;
  otherwise?: BaseValidator;
  /**
   * Determine where to to find the field value from, whether from the global context value or the local context value
   *
   * @default false
   */
  local?: boolean;
};

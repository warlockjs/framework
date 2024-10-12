import { type BaseValidator } from "src/warlock/validator/v/schema";

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

export type ContextualSchemaRule = SchemaRule & {
  /**
   * The context object is used to pass additional information to the rule
   * This will be always overridden when the rule is injected into a validator
   */
  context: {
    errorMessage?: string;
    options: Record<string, any>;
  };
};

export type SchemaRule = {
  name: string;
  description?: string;
  requiresValue?: boolean;
  validate: (
    this: ContextualSchemaRule,
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

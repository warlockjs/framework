import type { SchemaContext } from "./context-types";

/**
 * Mutator context
 */
export type MutatorContext = {
  /** Mutator options */
  options: any;
  /** Global validation context */
  ctx: SchemaContext;
};

/**
 * Mutator function - transforms data before validation
 */
export type Mutator = (data: any, context: MutatorContext) => Promise<any>;

/**
 * Contextualized mutator - mutator with runtime context
 */
export type ContextualizedMutator = {
  /** Mutation function */
  mutate: Mutator;
  /** Mutator context */
  context: {
    options: any;
    ctx: SchemaContext;
  };
};

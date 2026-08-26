import { CommandActionData } from "../../commands/types";

/**
 * One entry in the feature registry.
 *
 * Every feature owns a module of its own that exports a single value of this
 * shape, with its `onExecuting` body beside it; `features/index.ts` is only the
 * ordered index that collects them.
 */
export type FeatureDefinition = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  description: string;
  requires?: string[];
  script?: Record<string, string>;
  onExecuting?: (options: CommandActionData) => Promise<any>;
  ejectConfig?: {
    content: string;
    name: string;
  };
};

import { CommandActionData } from "../../commands/types";

/**
 * Internal placeholder for an @warlock.js dependency whose concrete version
 * comes from the installed Core package at command execution time.
 *
 * This is deliberately not a valid package-manager range. If a future code
 * path forgets to resolve it, installation fails loudly instead of silently
 * falling back to a stale framework major copied into a feature definition.
 */
export const INSTALLED_WARLOCK_VERSION = "__INSTALLED_WARLOCK_VERSION__";

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

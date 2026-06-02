import { SyncContext, SyncInstruction } from "./types.mjs";

//#region ../../@warlock.js/cascade/src/sync/sync-context.d.ts
/**
 * Default maximum sync depth.
 * Prevents infinite sync chains.
 */
declare const DEFAULT_MAX_SYNC_DEPTH = 3;
/**
 * Manages sync context and provides validation utilities.
 */
declare class SyncContextManager {
  /**
   * Creates a new sync context from a sync instruction.
   *
   * @param instruction - The sync instruction to create context from
   * @param affectedCount - Number of documents affected
   * @returns A new sync context
   */
  static createContext(instruction: SyncInstruction, affectedCount: number): SyncContext;
  /**
   * Validates if a sync operation can proceed based on depth and cycle detection.
   *
   * @param depth - Current sync depth
   * @param chain - Current sync chain
   * @param targetModel - Target model name
   * @param maxDepth - Maximum allowed depth
   * @param preventCircular - Whether to prevent circular references
   * @returns Validation result with success flag and optional error message
   */
  static validate(depth: number, chain: string[], targetModel: string, maxDepth: number, preventCircular: boolean): {
    valid: boolean;
    error?: string;
  };
  /**
   * Checks if adding a target model would create a cycle in the sync chain.
   *
   * @param chain - Current sync chain
   * @param targetModel - Model to be added to the chain
   * @returns True if adding the model would create a cycle
   */
  static hasCycle(chain: string[], targetModel: string): boolean;
  /**
   * Creates a new sync chain by appending a model name.
   *
   * @param chain - Current sync chain
   * @param modelName - Model name to append
   * @returns New sync chain array
   */
  static extendChain(chain: string[], modelName: string): string[];
  /**
   * Formats a sync chain for display.
   *
   * @param chain - Sync chain to format
   * @returns Formatted string (e.g., "Category → Product → Module")
   */
  static formatChain(chain: string[]): string;
  /**
   * Checks if the current depth allows for further syncing.
   *
   * @param currentDepth - Current depth in the chain
   * @param maxDepth - Maximum allowed depth
   * @returns True if more syncing is allowed
   */
  static canSyncDeeper(currentDepth: number, maxDepth: number): boolean;
}
//#endregion
export { DEFAULT_MAX_SYNC_DEPTH, SyncContextManager };
//# sourceMappingURL=sync-context.d.mts.map
import { FileManager } from "./file-manager.mjs";

//#region ../../@warlock.js/core/src/dev-server/dependency-graph.d.ts
/**
 * Dependency Graph
 * Tracks bidirectional relationships between files:
 * - dependencies: files that this file imports
 * - dependents: files that import this file
 *
 * Each forward edge also carries an `isTypeOnly` flag so cycle detection
 * can distinguish runtime cycles from ones formed purely by `import type`
 * edges — the latter are erased by TypeScript and have no runtime effect.
 */
declare class DependencyGraph {
  /**
   * Map of file -> files it depends on (imports).
   * Key: relative file path.
   * Value: relative dependency path → `{ isTypeOnly }` for that edge.
   */
  private dependencies;
  /**
   * Map of file -> files that depend on it (importers)
   * Key: relative file path
   * Value: Set of relative file paths that import this file
   */
  private dependents;
  /**
   * Reference to the files map for accessing FileManager instances
   * Used to read per-file typeOnlyDependencies during graph build.
   */
  private files;
  /**
   * Build dependency graph from FileManager map
   */
  build(files: Map<string, FileManager>): void;
  /**
   * Add a dependency relationship.
   * If the edge already exists, the type-only flag is ANDed: any runtime
   * statement between the two files makes the edge runtime permanently.
   *
   * @param file The file that has the dependency
   * @param dependency The file being depended upon
   * @param isTypeOnly Whether every reference from `file` to `dependency` is type-only
   */
  addDependency(file: string, dependency: string, isTypeOnly?: boolean): void;
  /**
   * Remove a dependency relationship
   * @param file The file that has the dependency
   * @param dependency The file being depended upon
   */
  removeDependency(file: string, dependency: string): void;
  /**
   * Remove all relationships for a file
   * @param file The file to remove
   */
  removeFile(file: string): void;
  /**
   * Update dependencies for a file.
   *
   * Accepts the updated `Set<string>` of dependency paths; when the caller
   * has per-edge type-only info, pass `typeOnlyDependencies` so the new
   * edges get the correct flag. Missing flag defaults to runtime.
   *
   * @param file The file to update
   * @param newDependencies New set of dependency paths
   * @param typeOnlyDependencies Subset of `newDependencies` whose edges are type-only
   */
  updateFile(file: string, newDependencies: Set<string>, typeOnlyDependencies?: Set<string>): void;
  /**
   * Get files that this file depends on (imports)
   * @param file The file to check
   * @returns Set of files this file imports
   */
  getDependencies(file: string): Set<string>;
  /**
   * Check whether the edge `file → dependency` is type-only.
   * Returns false if the edge does not exist.
   */
  isEdgeTypeOnly(file: string, dependency: string): boolean;
  /**
   * Get files that depend on this file (importers)
   * @param file The file to check
   * @returns Set of files that import this file
   */
  getDependents(file: string): Set<string>;
  /**
   * Get invalidation chain for a file
   * Returns all files that need to be reloaded when this file changes
   * Includes the file itself and all transitive dependents
   * @param file The file that changed
   * @returns Array of files to invalidate (in order)
   */
  getInvalidationChain(file: string): string[];
  /**
   * Detect circular dependencies in the dependency graph.
   * Uses depth-first search to find cycles.
   *
   * Filtering rule (per-edge): a cycle is suppressed when **any** edge in
   * the chain is type-only. TypeScript erases type-only imports entirely,
   * so a single type-only edge breaks the cycle at runtime. Only warn when
   * every edge is a runtime binding — that's the cycle that actually loops
   * at load time.
   *
   * @returns Array of circular dependency chains (each chain is an array of file paths)
   */
  detectCircularDependencies(): string[][];
  /**
   * True iff every edge in the cycle is a runtime binding. The cycle array
   * ends with a duplicate of its start (`[A, B, C, A]`) so we walk the
   * consecutive pairs once — any type-only edge means TS erases the loop
   * and there is no runtime cycle to report.
   */
  private isRuntimeCycle;
  /**
   * Display circular dependency warnings in a formatted, user-friendly way
   * Shows each cycle with visual tree structure and helpful recommendations
   */
  private displayCircularDependencyWarnings;
  /**
   * Get statistics about the dependency graph
   */
  getStats(): {
    totalFiles: number;
    totalDependencies: number;
    avgDependenciesPerFile: number;
    maxDependencies: number;
    maxDependents: number;
    mostDependingFile: string;
    mostDependedFile: string;
  };
}
//#endregion
export { DependencyGraph };
//# sourceMappingURL=dependency-graph.d.mts.map
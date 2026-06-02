//#region ../../@warlock.js/core/src/dev-server/types.d.ts
type FileType = "main" | "config" | "event" | "route" | "controller" | "service" | "model" | "other";
type FileManifest = {
  absolutePath: string;
  relativePath: string;
  lastModified: number;
  hash: string;
  dependencies: string[];
  /**
   * Subset of `dependencies` reached only through type-only imports
   * (`import type`, `export type`, or specifier lists where every entry is
   * prefixed with `type`). Used by the dependency graph to filter cycles
   * that have no runtime effect. Optional for backwards compatibility —
   * older manifests default to an empty set (every edge treated as runtime).
   */
  typeOnlyDependencies?: string[];
  dependents: string[];
  type: FileType;
};
/**
 * File processing state.
 *
 * - `idle`: not yet processed
 * - `loading`: reading source
 * - `ready`: parsed and available
 * - `deleted`: removed from disk
 */
type FileState = "idle" | "loading" | "ready" | "deleted";
//#endregion
export { FileManifest, FileState, FileType };
//# sourceMappingURL=types.d.mts.map
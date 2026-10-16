export type FileType =
  | "main"
  | "config"
  | "event"
  | "route"
  | "controller"
  | "service"
  | "model"
  | "other";

export type FileManifest = {
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
export type FileState = "idle" | "loading" | "ready" | "deleted";

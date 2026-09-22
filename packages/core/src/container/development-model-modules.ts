/**
 * A read-only view of development model modules for adapters that need to
 * bridge an already-loaded model into their own development module graph.
 *
 * This is intentionally a container-only internal contract: it is not a
 * package-root dev-server export and it exposes no module namespace.
 */
export type DevelopmentModelModuleState = "ready" | "removed";

export type DevelopmentModelModuleEntry = Readonly<{
  /** Exact file URL used by ModuleLoader to import the module. */
  url: string;
  /** Monotonic for this canonical path, including removal and re-addition. */
  generation: number;
  hasDefault: boolean;
  state: DevelopmentModelModuleState;
}>;

export type DevelopmentModelModules = {
  get(absolutePath: string): DevelopmentModelModuleEntry | undefined;
  subscribe(listener: (entry: DevelopmentModelModuleEntry) => void): () => void;
};

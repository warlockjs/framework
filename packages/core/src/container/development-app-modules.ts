/**
 * A read-only view of the `src/` files the development server has re-versioned,
 * for adapters (the web connector's Vite SSR graph) that must import those
 * files through the SAME native URL core's ESM loader hook uses, instead of
 * evaluating a second copy of them.
 *
 * Like {@link DevelopmentModelModules}, this is a container-only internal
 * contract: it is not a package-root dev-server export and it exposes no module
 * namespace.
 */
export type DevelopmentAppModuleEntry = Readonly<{
  /** The file's plain `file://` URL (no query), as `ModuleLoader` imports it. */
  url: string;
  /**
   * How many times core has bumped this file. It is the SAME counter the loader
   * hook thread keeps (`version-registry.ts`), so `${url}?v=${generation}` is
   * exactly the URL the loader hook resolves the file to.
   *
   * An entry is only ever published AFTER the hook thread has acknowledged the
   * bump, so reading this value and importing that URL cannot return the
   * previous instance.
   */
  generation: number;
}>;

export type DevelopmentAppModules = {
  /** `undefined` when the file was never bumped: its generation is 0. */
  get(absolutePath: string): DevelopmentAppModuleEntry | undefined;
  /** Called once per bumped file, after the hook thread flushed the bump. */
  subscribe(listener: (entry: DevelopmentAppModuleEntry) => void): () => void;
};

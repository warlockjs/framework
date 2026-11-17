import type { LegacyPanelModule } from "./types";

/** Imports a panel's view module. Replaceable so specs can serve a fixture instead of a URL. */
export type PanelModuleLoader = (id: string) => Promise<LegacyPanelModule>;

const defaultLoader: PanelModuleLoader = (id) =>
  import(/* @vite-ignore */ new URL(`panels/${id}/view.js`, location.href).href);

let loader: PanelModuleLoader = defaultLoader;
const modules = new Map<string, Promise<LegacyPanelModule>>();

/** Replaces the loader (specs); `null` restores the default. Clears the cache. */
export function setPanelModuleLoader(next: PanelModuleLoader | null): void {
  loader = next ?? defaultLoader;
  modules.clear();
}

/** Imports a panel's view module once per page load; a failed import is retried on the next call. */
export function loadPanelModule(id: string): Promise<LegacyPanelModule> {
  let loading = modules.get(id);

  if (!loading) {
    loading = loader(id);
    loading.catch(() => modules.delete(id));
    modules.set(id, loading);
  }

  return loading;
}

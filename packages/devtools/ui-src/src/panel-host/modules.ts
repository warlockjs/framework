import type { LegacyPanelModule } from "./types";

/** Imports a panel's view module. Replaceable so specs can serve a fixture instead of a URL. */
export type PanelModuleLoader = (id: string, shared?: boolean) => Promise<LegacyPanelModule>;

const defaultLoader: PanelModuleLoader = (id, shared = false) =>
  import(
    /* @vite-ignore */ new URL(shared ? "api/share/view.js" : `panels/${id}/view.js`, location.href)
      .href
  );

let loader: PanelModuleLoader = defaultLoader;
const modules = new Map<string, Promise<LegacyPanelModule>>();

/** Replaces the loader (specs); `null` restores the default. Clears the cache. */
export function setPanelModuleLoader(next: PanelModuleLoader | null): void {
  loader = next ?? defaultLoader;
  modules.clear();
}

/** Imports a panel's view module once per page load; a failed import is retried on the next call. */
export function loadPanelModule(id: string, shared = false): Promise<LegacyPanelModule> {
  const key = shared ? `share:${id}` : id;
  let loading = modules.get(key);

  if (!loading) {
    loading = shared ? loader(id, true) : loader(id);
    loading.catch(() => modules.delete(key));
    modules.set(key, loading);
  }

  return loading;
}

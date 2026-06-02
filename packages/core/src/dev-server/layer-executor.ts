import { loadEnv } from "@mongez/dotenv";
import { configManager } from "../config/config-manager";
import { connectorsManager } from "../connectors/connectors-manager";
import type { DependencyGraph } from "./dependency-graph";
import { devLogHMR } from "./dev-logger";
import { FileManager } from "./file-manager";
import type { ModuleLoader } from "./module-loader";
import type { SpecialFilesCollector } from "./special-files-collector";

/**
 * Decides what to reload when a batch of files changes.
 *
 * Strategy: bump the hook's version counter for every file in the
 * invalidation chain, wait for the hook worker to flush, then re-import
 * any special files (config / main / routes / events / locales) the chain
 * touched and restart any connector whose watched-files overlap the change.
 */
export class LayerExecutor {
  public constructor(
    private readonly dependencyGraph: DependencyGraph,
    private readonly specialFilesCollector: SpecialFilesCollector,
    private readonly moduleLoader: ModuleLoader,
    private readonly bumpVersion: (absolutePath: string) => void,
    private readonly flushVersionBumps: () => Promise<void>,
  ) {}

  /**
   * Entry point for the file watcher batch.
   *
   * @param changedPaths - code files added or changed in this batch
   * @param filesMap - all tracked files (relativePath → FileManager)
   * @param deletedFiles - paths that were removed from disk
   * @param allChangedPaths - includes .env so we can detect config reloads
   */
  public async executeBatchReload(
    changedPaths: string[],
    filesMap: Map<string, FileManager>,
    deletedFiles: string[],
    allChangedPaths?: string[],
  ): Promise<void> {
    const envFilesChanged = (allChangedPaths ?? []).some(isEnvPath);

    if (changedPaths.length === 0 && deletedFiles.length === 0 && !envFilesChanged) {
      return;
    }

    // Deletes: clean up routes/cleanup hooks for files that no longer exist.
    for (const path of deletedFiles) {
      const file = filesMap.get(path);
      if (file) this.moduleLoader.cleanupDeletedModule(file);
    }

    // Env-only change: reload all configs, restart connectors that watch them.
    if (changedPaths.length === 0 && envFilesChanged) {
      const configPaths = await this.reloadAffectedModules([".env"], filesMap);
      await this.restartAffectedConnectors(configPaths);
      return;
    }

    if (changedPaths.length === 0) return;

    const invalidationChain = new Set<string>();
    for (const path of changedPaths) {
      for (const file of this.dependencyGraph.getInvalidationChain(path)) {
        invalidationChain.add(file);
      }
      devLogHMR(path, invalidationChain.size - 1);
    }

    const chain = Array.from(invalidationChain);

    // Step 1: bump version counters so the next import() is fresh.
    for (const relativePath of chain) {
      const file = filesMap.get(relativePath);
      if (!file) continue;
      this.moduleLoader.runCleanup(file);
      this.bumpVersion(file.absolutePath);
      await file.process({ force: true });
    }

    // Step 2: wait for the hook worker to ack every bump.
    // Without this, resolve() may still return the old ?v=N URL.
    await this.flushVersionBumps();

    // Step 3: re-import affected special files.
    const affectedConfigPaths = await this.reloadAffectedModules(chain, filesMap);

    // Step 4: restart any connector whose watched-files overlap the chain.
    await this.restartAffectedConnectors([...changedPaths, ...affectedConfigPaths]);
  }

  private async restartAffectedConnectors(affectedFiles: string[]): Promise<void> {
    const toRestart = connectorsManager
      .list()
      .filter(connector => connector.shouldRestart(affectedFiles));

    for (const connector of toRestart) {
      await connector.restart();
    }
  }

  /**
   * Re-import every special file whose path or dependency-set intersects the
   * invalidation chain. Returns the relative paths of any config files that
   * reloaded so the caller can pass them to the connector-restart pass.
   */
  private async reloadAffectedModules(
    chain: string[],
    filesMap: Map<string, FileManager>,
  ): Promise<string[]> {
    const isEnvAffected = chain.some(isEnvPath);
    if (isEnvAffected) await loadEnv();

    const isAffected = (file: FileManager) => isFileAffected(file, chain);

    // Models self-register via the @RegisterModel decorator and rely on the
    // module-loader's registerCleanup() to attach Model.$cleanup (which
    // unregisters them on the next reload). That only happens inside
    // loadModule(), which models hit exactly once — at boot, via
    // autoDiscoverFiles. During HMR they're otherwise re-imported
    // *transitively* through routes, which never re-runs registerCleanup, so
    // after the first reload the cleanup list is empty and the registration
    // leaks ("Model X is already registered" on every subsequent edit).
    //
    // Re-importing changed model files through loadModule here re-attaches
    // $cleanup every cycle. It runs before the route pass so the decorator
    // registers once; the transitive route import then hits the cached ?v=N
    // and does not double-register.
    const affectedModels = chain
      .map(path => filesMap.get(path))
      .filter((file): file is FileManager => !!file && file.type === "model");

    for (const file of affectedModels) {
      await this.moduleLoader.loadModule(file, "model");
    }

    const collector = this.specialFilesCollector;
    const affectedConfigs = collector
      .getFilesByType("config")
      .filter(file => (isEnvAffected ? true : isAffected(file)));
    const affectedMains = collector.getFilesByType("main").filter(isAffected);
    const affectedRoutes = collector.getFilesByType("route").filter(isAffected);
    const affectedEvents = collector.getFilesByType("event").filter(isAffected);
    const affectedLocales = collector.getFilesByType("locale").filter(isAffected);

    const hasSpecialFiles =
      affectedConfigs.length > 0 ||
      affectedMains.length > 0 ||
      affectedRoutes.length > 0 ||
      affectedEvents.length > 0 ||
      affectedLocales.length > 0;

    // No entry points touched: reloading internal files alone is wasted work
    // because the hook will re-import them on next access anyway. But the
    // dep chain's last hop is usually the user-facing edge — give it a kick.
    if (!hasSpecialFiles) {
      const tail = filesMap.get(chain[chain.length - 1]);
      if (tail) await this.moduleLoader.reloadModule(tail);
      return [];
    }

    const configPaths: string[] = [];
    for (const file of affectedConfigs) {
      await configManager.reload(file);
      configPaths.push(file.relativePath);
    }

    // Order matters: locales first (translations used by main), main before
    // routes (registers state routes consume), events between (listeners).
    for (const file of affectedLocales) await this.moduleLoader.reloadModule(file);
    for (const file of affectedMains) await this.moduleLoader.reloadModule(file);
    for (const file of affectedEvents) await this.moduleLoader.reloadModule(file);
    for (const file of affectedRoutes) await this.moduleLoader.reloadModule(file);

    return configPaths;
  }
}

function isEnvPath(path: string): boolean {
  const basename = path.split("/").pop() ?? path;
  return basename === ".env" || basename.startsWith(".env.");
}

/**
 * A file is "affected" if it itself is in the chain or imports something in it.
 */
function isFileAffected(file: FileManager, chain: string[]): boolean {
  if (chain.includes(file.relativePath)) return true;
  for (const dep of file.dependencies) {
    if (chain.includes(dep)) return true;
  }
  return false;
}

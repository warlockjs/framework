import { loadEnv } from "@mongez/dotenv";
import type { ConfigLoader } from "./config-loader";
import type { Connector } from "./connectors/types";
import type { DependencyGraph } from "./dependency-graph";
import { devLogHMR } from "./dev-logger";
import type { FileManager } from "./file-manager";
import type { ModuleLoader } from "./module-loader";
import type { SpecialFilesCollector } from "./special-files-collector";

/**
 * LayerExecutor handles the execution of file reloads based on their layer type
 *
 * Strategy:
 * 1. Determine reload type (FSR or HMR) based on invalidation chain
 * 2. For FSR: Restart connectors if needed, reload special files
 * 3. For HMR: Clear module cache, reload affected modules
 */
export class LayerExecutor {
  public constructor(
    private readonly dependencyGraph: DependencyGraph,
    private readonly specialFilesCollector: SpecialFilesCollector,
    private readonly connectors: Connector[],
    private readonly moduleLoader: ModuleLoader,
    private readonly configLoader: ConfigLoader,
  ) {}

  /**
   * Execute batch reload for multiple changed files
   * @param changedPaths Array of relative paths that changed
   * @param filesMap Map of all FileManager instances
   */
  public async executeBatchReload(
    changedPaths: string[],
    filesMap: Map<string, FileManager>,
  ): Promise<void> {
    if (changedPaths.length === 0) {
      return;
    }

    // Build combined invalidation chain for all changed files
    const allInvalidatedFiles = new Set<string>();
    const fsrFiles: string[] = [];
    const hmrFiles: string[] = [];

    for (const relativePath of changedPaths) {
      const fileManager = filesMap.get(relativePath);
      if (!fileManager) continue;

      // Get invalidation chain for this file
      const invalidationChain = this.dependencyGraph.getInvalidationChain(relativePath);

      // Add to combined set
      invalidationChain.forEach((file) => allInvalidatedFiles.add(file));

      // Determine strategy for this file
      const strategy = this.determineReloadStrategy(invalidationChain, filesMap);

      if (strategy === "FSR") {
        fsrFiles.push(relativePath);
      } else {
        hmrFiles.push(relativePath);
      }
    }

    try {
      hmrFiles.forEach((file) => {
        const dependentCount = this.dependencyGraph.getInvalidationChain(file).length - 1;
        const fileSystem = filesMap.get(file);
        if (fileSystem) {
          this.moduleLoader.clearModuleCache(fileSystem.absolutePath);
          __clearModuleVersion(fileSystem.cachePath);
        }

        devLogHMR(file, dependentCount > 0 ? dependentCount : undefined);
      });
    } catch (error) {
      console.log("ERRor in devLogHMR: ", error);
    }

    try {
      // Execute reload once for all files
      const invalidationChain = Array.from(allInvalidatedFiles);

      if (fsrFiles.length > 0) {
        // If any file requires FSR, do FSR for all
        const firstFsrFile = filesMap.get(fsrFiles[0])!;
        await this.executeFullServerRestart(firstFsrFile, invalidationChain, filesMap);
      } else {
        // All files are HMR
        const firstHmrFile = filesMap.get(hmrFiles[0])!;
        await this.executeHotModuleReplacement(firstHmrFile, invalidationChain, filesMap, hmrFiles);
      }
    } catch (error) {
      console.log("ERRor in executeFullServerRestart: ", error);
    }
  }

  /**
   * Determine if we need FSR or HMR
   * FSR is needed if ANY file in the invalidation chain is FSR layer
   */
  private determineReloadStrategy(
    invalidationChain: string[],
    filesMap: Map<string, FileManager>,
  ): "FSR" | "HMR" {
    for (const relativePath of invalidationChain) {
      const file = filesMap.get(relativePath);
      if (file && file.layer === "FSR") {
        return "FSR";
      }
    }
    return "HMR";
  }

  /**
   * Execute Full Server Restart
   * This happens when config, routes, or other FSR layer files change
   */
  private async executeFullServerRestart(
    changedFile: FileManager,
    invalidationChain: string[],
    filesMap: Map<string, FileManager>,
  ): Promise<void> {
    // Step 1: Handle config files specially
    const configFiles = invalidationChain
      .map((path) => filesMap.get(path))
      .filter((file): file is FileManager => file !== undefined && file.type === "config");

    if (configFiles.length > 0) {
      // Reload config files first
      for (const configFile of configFiles) {
        await this.configLoader.reloadConfig(configFile);
      }

      // Restart only affected connectors
      await this.restartAffectedConnectors(invalidationChain);

      // Clear module cache for invalidation chain
      this.clearModuleCacheForChain(invalidationChain, filesMap);

      // Reload special files if affected
      await this.reloadAffectedSpecialFiles(invalidationChain);
      return;
    }

    // Step 2: For non-config FSR (routes, etc.), restart all connectors
    await this.restartAffectedConnectors(invalidationChain);

    // Step 3: Clear module cache for invalidation chain
    this.clearModuleCacheForChain(invalidationChain, filesMap);

    // Step 4: Reload special files if affected
    await this.reloadAffectedSpecialFiles(invalidationChain);
  }

  /**
   * Execute Hot Module Replacement
   * This happens when only HMR layer files (controllers, services, etc.) change
   */
  private async executeHotModuleReplacement(
    changedFile: FileManager,
    invalidationChain: string[],
    filesMap: Map<string, FileManager>,
    hmrFiles: string[],
  ): Promise<void> {
    // Step 1: Clear module cache for invalidation chain
    this.clearModuleCacheForChain(invalidationChain, filesMap);

    // Step 2: Reload affected modules
    await this.reloadAffectedModules(invalidationChain, filesMap);

    await this.restartAffectedConnectors(hmrFiles);
  }

  /**
   * Restart connectors that are affected by the changed files
   */
  private async restartAffectedConnectors(affectedFiles: string[]): Promise<void> {
    const connectorsToRestart = this.connectors.filter((connector) =>
      connector.shouldRestart(affectedFiles),
    );

    if (connectorsToRestart.length === 0) {
      return;
    }

    // Restart in priority order
    for (const connector of connectorsToRestart) {
      connector.restart();
    }
  }

  /**
   * Clear Node.js module cache for the invalidation chain
   */
  private clearModuleCacheForChain(
    invalidationChain: string[],
    filesMap: Map<string, FileManager>,
  ): void {
    for (const relativePath of invalidationChain) {
      const file = filesMap.get(relativePath);
      if (file) {
        this.moduleLoader.clearModuleCache(file.absolutePath);

        // Update module version for HMR cache busting
        __updateModuleVersion(`./${file.cachePath}`, Date.now());
      }
    }
  }

  /**
   * Reload special files that are affected by the change
   * This includes main, routes, events, locales
   * Special files are reloaded if they are in the invalidation chain OR if they depend on files in the chain
   */
  private async reloadAffectedSpecialFiles(invalidationChain: string[]): Promise<void> {
    // Helper to check if a file is affected (either in chain or depends on chain)
    const isAffected = (file: FileManager): boolean => {
      // Direct match: file itself is in the chain
      if (invalidationChain.includes(file.relativePath)) {
        return true;
      }
      // Indirect match: file depends on something in the chain
      for (const dep of file.dependencies) {
        if (invalidationChain.includes(dep)) {
          return true;
        }
      }
      return false;
    };

    // Check which special files are affected
    const affectedMainFiles = this.specialFilesCollector.getMainFiles().filter(isAffected);

    const affectedRouteFiles = this.specialFilesCollector.getRouteFiles().filter(isAffected);

    const affectedEventFiles = this.specialFilesCollector.getEventFiles().filter(isAffected);

    const affectedLocaleFiles = this.specialFilesCollector.getLocaleFiles().filter(isAffected);

    // Reload affected special files
    if (affectedMainFiles.length > 0) {
      for (const file of affectedMainFiles) {
        await this.moduleLoader.reloadModule(file);
      }
    }

    if (affectedLocaleFiles.length > 0) {
      for (const file of affectedLocaleFiles) {
        await this.moduleLoader.reloadModule(file);
      }
    }

    if (affectedEventFiles.length > 0) {
      for (const file of affectedEventFiles) {
        await this.moduleLoader.reloadModule(file);
      }
    }

    if (affectedRouteFiles.length > 0) {
      for (const file of affectedRouteFiles) {
        await this.moduleLoader.reloadModule(file);
      }
    }
  }

  /**
   * Reload affected modules (for HMR)
   * Special files (main, routes, events, locales) need to be actively reloaded
   * Other files will be loaded on next import
   */
  private async reloadAffectedModules(
    invalidationChain: string[],
    filesMap: Map<string, FileManager>,
  ): Promise<void> {
    // Helper to check if a file is affected (either in chain or depends on chain)
    const isAffected = (file: FileManager): boolean => {
      // Direct match: file itself is in the chain
      if (invalidationChain.includes(file.relativePath)) {
        return true;
      }
      // Indirect match: file depends on something in the chain
      for (const dep of file.dependencies) {
        if (invalidationChain.includes(dep)) {
          return true;
        }
      }
      return false;
    };

    const isEnvFileAffected = invalidationChain.some((path) => path.endsWith(".env"));

    if (isEnvFileAffected) {
      await loadEnv();
    }

    // Check which special files are affected
    const affectedMainFiles = this.specialFilesCollector.getMainFiles().filter(isAffected);

    const affectedConfigFiles = this.specialFilesCollector
      .getConfigFiles()
      .filter((file) => (isEnvFileAffected ? true : isAffected(file)));

    const affectedRouteFiles = this.specialFilesCollector.getRouteFiles().filter(isAffected);

    const affectedEventFiles = this.specialFilesCollector.getEventFiles().filter(isAffected);

    const affectedLocaleFiles = this.specialFilesCollector.getLocaleFiles().filter(isAffected);

    const hasSpecialFiles =
      affectedMainFiles.length > 0 ||
      affectedRouteFiles.length > 0 ||
      affectedEventFiles.length > 0 ||
      affectedLocaleFiles.length > 0 ||
      affectedConfigFiles.length > 0;

    if (!hasSpecialFiles) {
      return;
    }

    if (affectedConfigFiles.length > 0) {
      for (const file of affectedConfigFiles) {
        await this.configLoader.reloadConfig(file);
      }
    }

    // Reload special files
    if (affectedMainFiles.length > 0) {
      for (const file of affectedMainFiles) {
        await this.moduleLoader.reloadModule(file);
      }
    }

    if (affectedLocaleFiles.length > 0) {
      for (const file of affectedLocaleFiles) {
        await this.moduleLoader.reloadModule(file);
      }
    }

    if (affectedEventFiles.length > 0) {
      for (const file of affectedEventFiles) {
        await this.moduleLoader.reloadModule(file);
      }
    }

    if (affectedRouteFiles.length > 0) {
      for (const file of affectedRouteFiles) {
        await this.moduleLoader.reloadModule(file);
      }
    }
  }
}

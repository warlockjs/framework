import { colors } from "@mongez/copper";
import events from "@mongez/events";
import { fileExistsAsync, unlinkAsync } from "@warlock.js/fs";
import { Application } from "../application";
import { connectorsManager } from "../connectors/connectors-manager";
import { ConnectorLifecyclePhase } from "../connectors/types";
import { warlockConfigManager } from "../warlock-config";
import { devLogInfo, devLogReady, devLogSection, devLogWarn, devServeLog } from "./dev-logger";
import { filesOrchestrator } from "./files-orchestrator";
import { MANIFEST_PATH } from "./flags";
import { LayerExecutor } from "./layer-executor";
import { restartDevServer } from "./restart-dev-server";
import { devServerShortcuts } from "./shortcuts";
import type { StartDevServerOptions } from "./start-development-server";
import { typeGenerator } from "./type-generator";

type Batch = { added: string[]; changed: string[]; deleted: string[] };

/**
 * Top-level coordinator for `warlock dev`. Wires the file orchestrator, the
 * connectors, and the layer executor together, and listens for the watcher's
 * batched events to drive HMR.
 */
export class DevelopmentServer {
  private layerExecutor?: LayerExecutor;
  private running = false;
  private readonly options: StartDevServerOptions;

  public constructor(options: StartDevServerOptions = {}) {
    this.options = options;
    devLogSection("Starting Development Server...");
  }

  public async start(): Promise<void> {
    try {
      const startedAt = performance.now();

      // --fresh deletes the manifest so reconciliation re-parses every file
      // from disk. Transpile caching is owned by the loader hook (in-memory).
      if (this.options.fresh && (await fileExistsAsync(MANIFEST_PATH))) {
        await unlinkAsync(MANIFEST_PATH);
        devServeLog(colors.cyanBright("Cleared manifest (--fresh)"));
      }

      await filesOrchestrator.init();
      await filesOrchestrator.initializeAll();
      await filesOrchestrator.watchFiles();

      filesOrchestrator.specialFilesCollector.collect(filesOrchestrator.getFiles());

      this.setupEventListeners();

      // Decorator-driven registries (models, etc.) must be populated before
      // routes/services can resolve symbols by name.
      await this.autoDiscoverFiles();

      await filesOrchestrator.moduleLoader.loadAll();

      // Late-phase connectors (http, socket) bind after app code has
      // registered routes/listeners.
      await connectorsManager.startPhase(ConnectorLifecyclePhase.Late);

      this.layerExecutor = new LayerExecutor(
        filesOrchestrator.getDependencyGraph(),
        filesOrchestrator.specialFilesCollector,
        filesOrchestrator.moduleLoader,
        (absolutePath) => filesOrchestrator.bumpVersion(absolutePath),
        () => filesOrchestrator.flushVersionBumps(),
      );

      this.running = true;

      const duration = performance.now() - startedAt;
      devLogReady(`Development Server is ready in ${colors.greenBright(parseDuration(duration))}`);

      // App modules are loaded and both connector phases are active — signal a
      // complete boot so `Application.onceBooted(...)` listeners fire.
      Application.markBooted({
        environment: Application.environment,
        runtimeStrategy: Application.runtimeStrategy,
        bootDurationMs: duration,
      });

      // Precedence: explicit CLI option > devServer.* config > default.
      const devServerConfig = await warlockConfigManager.get("devServer");
      const generateTypings =
        this.options.generateTypings ?? devServerConfig?.generateTypings ?? true;
      const healthCheckers = this.options.healthCheckers ?? devServerConfig?.healthCheckers ?? true;

      if (generateTypings) typeGenerator.executeGenerateAllCommand();

      if (healthCheckers) {
        filesOrchestrator.startCheckingHealth(healthCheckers === true ? undefined : healthCheckers);
      }
    } catch (error) {
      devServeLog(colors.redBright(`Failed to start Development Server: ${error}`));
      await this.shutdown();
      throw error;
    }
  }

  /**
   * Eagerly import files whose decorators populate global registries so any
   * symbol-by-name resolution later in boot finds them.
   */
  private async autoDiscoverFiles(): Promise<void> {
    const discoveryTypes = ["model"] as const;
    for (const file of filesOrchestrator.files.values()) {
      if (file.type && (discoveryTypes as readonly string[]).includes(file.type)) {
        await filesOrchestrator.moduleLoader.loadModule(file, file.type);
      }
    }
  }

  private setupEventListeners(): void {
    events.on("dev-server:batch-complete", (batch: Batch) => this.handleBatchComplete(batch));
  }

  private async handleBatchComplete(batch: Batch): Promise<void> {
    if (!this.running || !this.layerExecutor) return;

    // warlock.config.ts holds settings read at boot (CLI commands, build
    // options, watch patterns, scheduled jobs) and .env feeds every config
    // that reads it. Neither can be hot-reloaded without leaving running
    // services configured with stale values, so the only honest response is
    // a full restart.
    const restartTrigger = this.findRestartTrigger(batch);

    if (restartTrigger) {
      // On success this never comes back — the process exits and the
      // supervisor replaces it. Reaching the next line means the restart was
      // declined by config or wasn't possible, so we fall through and still
      // hot-reload whatever ordinary code shared the batch.
      await this.restartForConfigChange(restartTrigger);
    }

    // No-op saves (an editor that fsyncs without a content write) are already
    // filtered upstream by the file hash in FileEventHandler, so batch.changed
    // only contains genuinely-changed paths by the time it reaches here.

    const total = batch.added.length + batch.changed.length + batch.deleted.length;
    if (total === 0) return;

    // Boot-time files still ride along in `changed` when a restart was
    // declined (`restartOnConfigChange: false`) or wasn't possible — they are
    // never hot-reloaded, so keep them out of the reload set either way.
    const codeFiles = [...batch.added, ...batch.changed].filter(
      (p) => !isEnvPath(p) && p !== "warlock.config.ts",
    );

    try {
      await this.layerExecutor.executeBatchReload(
        codeFiles,
        filesOrchestrator.getFiles(),
        batch.deleted,
        batch.changed,
      );

      typeGenerator.executeTypingsGenerator([...batch.added, ...batch.changed]);

      filesOrchestrator.checkHealth(batch);
    } catch (error) {
      devServeLog(colors.redBright(`Failed to execute batch reload: ${error}`));
    }
  }

  /**
   * The boot-time file in this batch that can only be applied by restarting,
   * or `undefined` when the batch is ordinary application code.
   */
  private findRestartTrigger(batch: Batch): string | undefined {
    if (batch.changed.includes("warlock.config.ts")) {
      return "warlock.config.ts";
    }

    return [...batch.added, ...batch.changed].find(isEnvPath);
  }

  /**
   * Restart so a changed boot-time file actually takes effect.
   *
   * Opt out with `devServer.restartOnConfigChange: false` and the old
   * behaviour returns: a warning telling you to restart yourself. If the
   * restart can't be performed at all (no supervisor, a shutdown that threw),
   * `restartDevServer` reports it and we fall back to the same warning rather
   * than leaving the server running against config it isn't using.
   */
  private async restartForConfigChange(file: string): Promise<void> {
    const devServerConfig = await warlockConfigManager.get("devServer");

    if (devServerConfig?.restartOnConfigChange === false) {
      devLogWarn(`${file} changed — restart the dev server to apply.`);
      return;
    }

    devLogInfo(`${file} changed — restarting to apply.`);

    const restarted = await restartDevServer(this);

    if (!restarted) {
      devLogWarn(`${file} changed — restart the dev server to apply.`);
    }
  }

  public async shutdown(): Promise<void> {
    // Always hand the terminal back, even on a repeat/no-op shutdown — a
    // process that exits while stdin is still in raw mode leaves the user's
    // shell without line editing or Ctrl+C.
    devServerShortcuts.release();

    if (!this.running) return;
    devServeLog(colors.redBright("Shutting down Development Server..."));
    this.running = false;
    await connectorsManager.shutdown();
    devServeLog(colors.greenBright("Development Server stopped"));
  }

  public isRunning(): boolean {
    return this.running;
  }
}


function isEnvPath(path: string): boolean {
  const basename = path.split("/").pop() ?? path;
  return basename === ".env" || basename.startsWith(".env.");
}

function parseDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  if (ms > 60_000) return `${(ms / 60_000).toFixed(2)}m`;
  return `${(ms / 1000).toFixed(2)}s`;
}

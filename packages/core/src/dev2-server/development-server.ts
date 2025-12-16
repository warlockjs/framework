import { colors } from "@mongez/copper";
import events from "@mongez/events";
import { bootstrap } from "../bootstrap";
import { registerConfigHandlers } from "./config-handlers";
import { ConfigLoader } from "./config-loader";
import type { Connector } from "./connectors";
import { CacheConnector } from "./connectors/cache-connector";
import { DatabaseConnector } from "./connectors/database-connector";
import { HttpConnector } from "./connectors/http-connector";
import { devLogInfo, devLogReady, devLogSection, devServeLog } from "./dev-logger";
import { FilesOrchestrator } from "./files-orchestrator";
import { LayerExecutor } from "./layer-executor";
import { ModuleLoader } from "./module-loader";
import { initializeRuntimeImportHelper } from "./runtime-import-helper";
import { SpecialFilesCollector } from "./special-files-collector";

/**
 * Development Server
 * Main coordinator for the dev server
 * Manages file system, connectors, and hot reloading
 */
export class DevelopmentServer {
  /**
   * Special files collector - categorizes and provides access to special files
   */
  private readonly specialFilesCollector = new SpecialFilesCollector();

  /**
   * Files orchestrator - manages file discovery, watching, and dependency graph
   */
  private readonly filesOrchestrator = new FilesOrchestrator(this.specialFilesCollector);

  /**
   * Config loader - dynamically loads configuration files
   */
  private readonly configLoader = new ConfigLoader();

  /**
   * Module loader - dynamically loads application modules
   */
  private moduleLoader?: ModuleLoader;

  /**
   * Layer executor - handles HMR and FSR execution
   */
  private layerExecutor?: LayerExecutor;

  /**
   * Registered connectors (Database, HTTP, Cache, etc.)
   * Sorted by priority
   */
  private readonly connectors: Connector[] = [];

  /**
   * Whether the server is currently running
   */
  private running: boolean = false;

  public constructor() {
    devLogSection("Starting Development Server...");
    // Register special config handlers
    registerConfigHandlers(this.configLoader);

    // Register default connectors
    this.registerConnector(new DatabaseConnector());
    this.registerConnector(new CacheConnector());
    this.registerConnector(new HttpConnector());
  }

  /**
   * Register a connector
   * Connectors are automatically sorted by priority
   */
  public registerConnector(connector: Connector): void {
    this.connectors.push(connector);
    // Sort by priority (lower numbers first)
    this.connectors.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Initialize and start the development server
   */
  public async start(): Promise<void> {
    try {
      // STEP 1: Initialize file system (discover and process files)
      await this.filesOrchestrator.init();

      devLogInfo("Initializing special files...");
      // STEP 2: Collect special files
      this.specialFilesCollector.collect(this.filesOrchestrator.getFiles());

      devLogInfo("Bootstrapping...");
      // STEP 3: Bootstrap (load environment variables)
      await bootstrap();

      devLogInfo("Initializing runtime import helper...");
      // STEP 4: Initialize runtime import helper (for HMR cache busting)
      initializeRuntimeImportHelper();

      devLogInfo("Loading configuration files...");
      // STEP 5: Load configuration files
      const configFiles = this.specialFilesCollector.getConfigFiles();
      
      await this.configLoader.loadAll(configFiles);

      devLogInfo("Setting up event listeners...");
      // STEP 6: Setup event listeners
      this.setupEventListeners();

      
      // STEP 7: Load application modules
      devLogInfo("Loading application modules...");
      this.moduleLoader = new ModuleLoader(this.specialFilesCollector);
      await this.moduleLoader.loadAll();

      // STEP 8: Initialize connectors
      devLogInfo("Initializing connectors...");
      this.initConnectors();

      // STEP 9: Initialize layer executor
      devLogInfo("Initializing layer executor...");
      this.layerExecutor = new LayerExecutor(
        this.filesOrchestrator.getDependencyGraph(),
        this.specialFilesCollector,
        this.connectors,
        this.moduleLoader,
        this.configLoader,
      );

      // Mark as running
      this.running = true;

      devLogReady("Development Server is ready!");
    } catch (error) {
      devServeLog(colors.redBright(`❌ Failed to start Development Server: ${error}`));
      await this.shutdown();
      throw error;
    }
  }

  /**
   * Initialize all registered connectors in priority order
   */
  private async initConnectors(): Promise<void> {
    devLogInfo("Initializing connectors...");
    for (const connector of this.connectors) {
      connector.start().catch((error) => {
        devServeLog(colors.redBright(`❌ Failed to initialize ${connector.name}: ${error}`));
      });
    }
  }

  /**
   * Setup event listeners for file changes
   */
  private setupEventListeners(): void {
    // Listen to batch completion events from FileEventHandler
    events.on(
      "dev-server:batch-complete",
      (batch: { added: string[]; changed: string[]; deleted: string[] }) => {
        this.handleBatchComplete(batch);
      },
    );
  }

  /**
   * Handle batch completion event
   * Triggered when a batch of files has been processed
   */
  private async handleBatchComplete(batch: {
    added: string[];
    changed: string[];
    deleted: string[];
  }): Promise<void> {
    // Only execute reload if server is running (skip during initial startup)
    if (!this.running || !this.layerExecutor) {
      return;
    }

    // Get all changed files (added + changed + deleted)
    const allChangedPaths = [...batch.added, ...batch.changed, ...batch.deleted];

    if (allChangedPaths.length === 0) {
      return;
    }

    // Delegate to layer executor for batch reload
    try {
      await this.layerExecutor.executeBatchReload(
        allChangedPaths,
        this.filesOrchestrator.getFiles(),
      );
    } catch (error) {
      devServeLog(colors.redBright(`❌ Failed to execute batch reload: ${error}`));
    }
  }

  /**
   * @deprecated Use LayerExecutor instead
   */
  private async handleFullServerRestart(
    connectorsToRestart: Connector[],
    affectedFiles: string[],
  ): Promise<void> {
    devServeLog(
      colors.yellowBright(`🔄 FSR: Restarting ${connectorsToRestart.length} connector(s)...`),
    );
    devServeLog(colors.yellowBright(`   Affected files: ${affectedFiles.length} file(s)`));

    for (const connector of connectorsToRestart) {
      try {
        await connector.restart();
      } catch (error) {
        devServeLog(colors.redBright(`❌ Failed to restart ${connector.name}: ${error}`));
      }
    }

    devServeLog(colors.greenBright(`✅ FSR completed`));
  }

  /**
   * Gracefully shutdown the development server
   */
  public async shutdown(): Promise<void> {
    if (!this.running) {
      return;
    }

    devServeLog(colors.redBright("🛑 Shutting down Development Server..."));

    this.running = false;

    // Shutdown connectors in reverse priority order
    const reversedConnectors = [...this.connectors].reverse();

    for (const connector of reversedConnectors) {
      try {
        await connector.shutdown();
      } catch (error) {
        devServeLog(colors.redBright(`❌ Failed to shutdown ${connector.name}: ${error}`));
      }
    }

    devServeLog(colors.greenBright("✅ Development Server stopped"));
  }

  /**
   * Check if server is running
   */
  public isRunning(): boolean {
    return this.running;
  }

  /**
   * Get files orchestrator (for advanced usage)
   */
  public getFilesOrchestrator(): FilesOrchestrator {
    return this.filesOrchestrator;
  }

  /**
   * Get special files collector
   */
  public getSpecialFilesCollector(): SpecialFilesCollector {
    return this.specialFilesCollector;
  }

  /**
   * Get config loader
   */
  public getConfigLoader(): ConfigLoader {
    return this.configLoader;
  }

  /**
   * Get module loader
   */
  public getModuleLoader(): ModuleLoader | undefined {
    return this.moduleLoader;
  }

  /**
   * Get registered connectors
   */
  public getConnectors(): Connector[] {
    return [...this.connectors];
  }
}

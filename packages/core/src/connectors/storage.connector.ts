import { storage } from "../storage";
import { loadS3 } from "../storage/drivers/cloud-driver";
import { BaseConnector } from "./base-connector";
import { ConnectorLifecyclePhase, ConnectorPriority } from "./types";

/**
 * Cache Connector
 * Manages cache engine connection lifecycle
 */
export class StorageConnector extends BaseConnector {
  public readonly name = "storage";
  public readonly priority = ConnectorPriority.STORAGE;
  public readonly lifecyclePhase = ConnectorLifecyclePhase.Early;

  /**
   * Files that trigger cache restart
   */
  protected readonly watchedFiles = ["src/config/storage.ts", "src/config/storage.tsx"];

  /**
   * Initialize storage.
   *
   * Unlike its siblings (database, cache, herald), this connector does NOT
   * early-return when `config.get("storage")` is absent. Storage is
   * intentionally always-on: `storage.init()` registers a built-in `local`
   * driver rooted at `uploadsPath()` before reading configured drivers, so file
   * storage works out of the box even when a project ships no
   * `src/config/storage.ts`. A config-presence guard here would break that.
   *
   * That fallback is real as of 4.11.0. Until then this comment described it
   * and nothing implemented it, so every app without `src/config/storage.ts`
   * died at boot with `Storage driver "local" is not configured` — a decision
   * to skip the guard, taken on the authority of behaviour nobody had written.
   * See `Storage.registerBuiltInLocalDriver`.
   */
  public async start(): Promise<void> {
    await loadS3();
    await storage.init();

    this.active = true;
  }

  /**
   * Shutdown cache connection
   */
  public async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    storage.reset();

    this.active = false;
  }
}

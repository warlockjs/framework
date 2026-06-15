import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { BaseConnector } from "./base-connector";
import { ConnectorLifecyclePhase, ConnectorPriority } from "./types";

/**
 * Access Connector
 *
 * Wires `@warlock.js/access` from `src/config/access.ts` at boot: reads the
 * exported config object and hands it to the package's `setAccessConfig`, which
 * validates that a resolver is present — so a misconfigured authorization layer
 * fails at STARTUP, not on the first protected request. Config files stay
 * declarative; the connector performs the side-effect.
 *
 * The package is lazy-imported (only when an access config is present), so core
 * carries no hard dependency on it — the same pattern as the notifications and
 * herald connectors.
 */
export class AccessConnector extends BaseConnector {
  public readonly name = "access";
  public readonly priority = ConnectorPriority.ACCESS;
  public readonly lifecyclePhase = ConnectorLifecyclePhase.Early;

  /**
   * Files that trigger an access restart
   */
  protected readonly watchedFiles = ["src/config/access.ts"];

  /**
   * Register the access configuration with the package.
   */
  public async start(): Promise<void> {
    const accessConfiguration = config.get("access");

    if (!accessConfiguration) {
      return;
    }

    const { setAccessConfig } = await import("@warlock.js/access");

    setAccessConfig(accessConfiguration);
    this.active = true;

    log.info("access", "configured", "Authorization wired from config/access.ts");
  }

  /**
   * Clear the active config so a dev restart re-registers from the (possibly
   * changed, or now-removed) config file. The package holds no external
   * connection of its own.
   */
  public async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    const { resetAccessConfig } = await import("@warlock.js/access");

    resetAccessConfig();
    this.active = false;
  }
}

import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { BaseConnector } from "./base-connector";
import { ConnectorLifecyclePhase, ConnectorPriority } from "./types";

/**
 * AI Connector
 *
 * Wires `@warlock.js/ai` from `src/config/ai.ts` at boot: reads the exported
 * config object and hands it to the package's `ai.config(...)`. Config files stay
 * declarative; the connector performs the side-effect.
 *
 * The package is lazy-imported (only when an ai config is present), so core
 * carries no hard dependency on it — the same pattern as the access,
 * notifications and herald connectors.
 *
 * Because the satellite packages' side-effect imports sit at the TOP of
 * config/ai.ts, they have already registered their surface on `ai` (ai.tools /
 * ai.mcp, ai.workspace, panoptic) by the time config-loader runs the file and
 * this connector applies the config — so this single `ai.config(...)` call also
 * fires panoptic's onConfigApplied wiring.
 */
export class AiConnector extends BaseConnector {
  public readonly name = "ai";
  public readonly priority = ConnectorPriority.AI;
  public readonly lifecyclePhase = ConnectorLifecyclePhase.Early;

  /**
   * Files that trigger an ai restart
   */
  protected readonly watchedFiles = ["src/config/ai.ts"];

  /**
   * Register the ai configuration with the package.
   */
  public async start(): Promise<void> {
    const aiConfiguration = config.get("ai");

    if (!aiConfiguration) return;

    const { ai } = await import("@warlock.js/ai");

    ai.config(aiConfiguration);
    this.active = true;

    log.info("ai", "configured", "AI wired from config/ai.ts");
  }

  /**
   * Clear the active flag so a dev restart re-registers from the (possibly
   * changed, or now-removed) config file. The package holds no external
   * connection of its own.
   */
  public async shutdown(): Promise<void> {
    if (!this.active) return;

    this.active = false;
  }
}

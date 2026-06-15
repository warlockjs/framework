import config from "@mongez/config";
import { log } from "@warlock.js/logger";
import { BaseConnector } from "./base-connector";
import { ConnectorLifecyclePhase, ConnectorPriority } from "./types";

/**
 * Notifications Connector
 *
 * Wires `@warlock.js/notifications` from `src/config/notifications.ts` at boot:
 * reads the exported config object and hands it to the package's
 * `setNotificationConfig`. Config files stay declarative — they export the
 * config, the connector performs the side-effect.
 *
 * The package is lazy-imported (only when a notifications config is present),
 * so core carries no hard dependency on it — the same pattern as the herald
 * connector with `@warlock.js/herald`.
 */
export class NotificationsConnector extends BaseConnector {
  public readonly name = "notifications";
  public readonly priority = ConnectorPriority.NOTIFICATIONS;
  public readonly lifecyclePhase = ConnectorLifecyclePhase.Early;

  /**
   * Files that trigger a notifications restart
   */
  protected readonly watchedFiles = ["src/config/notifications.ts"];

  /**
   * Register the notifications configuration with the package.
   */
  public async start(): Promise<void> {
    const notificationsConfig = config.get("notifications");

    if (!notificationsConfig) {
      return;
    }

    const { setNotificationConfig } = await import("@warlock.js/notifications");

    setNotificationConfig(notificationsConfig);
    this.active = true;

    log.info("notifications", "configured", "Notifications wired from config/notifications.ts");
  }

  /**
   * Nothing to tear down — the package holds no external connection of its own
   * (the optional queue worker + its broker own their lifecycle). Clear the
   * active flag so a dev restart re-registers from the (possibly changed) config.
   */
  public async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    this.active = false;
  }
}

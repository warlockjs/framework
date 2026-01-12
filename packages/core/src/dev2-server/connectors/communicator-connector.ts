import config from "@mongez/config";
import { communicatorRegistry, connectToCommunicator } from "@warlock.js/herald";
import { log } from "@warlock.js/logger";
import { BaseConnector } from "./base-connector";
import { ConnectorPriority } from "./types";

/**
 * Communicator Connector
 * Manages message broker connection lifecycle using @warlock.js/herald
 */
export class CommunicatorConnector extends BaseConnector {
  public readonly name = "communicator";
  public readonly priority = ConnectorPriority.COMMUNICATOR;

  /**
   * Files that trigger communicator restart
   */
  protected readonly watchedFiles = [
    ".env",
    "src/config/communicator.ts",
    "src/config/communicator.tsx",
  ];

  /**
   * Initialize communicator connection
   */
  public async start(): Promise<void> {
    const communicatorConfig = config.get("communicator");

    if (!communicatorConfig) {
      return;
    }

    try {
      log.info(
        `communicator.${communicatorConfig.driver}`,
        "connection",
        "Connecting to communicator",
      );
      await connectToCommunicator(communicatorConfig);
      log.success(
        `communicator.${communicatorConfig.driver}`,
        "connection",
        "Connected to communicator",
      );
      this.active = true;
    } catch (error) {
      console.error("Failed to connect to communicator:", error);
      log.error(
        `communicator.${communicatorConfig.driver}`,
        "connection",
        "Failed to connect to communicator",
      );
      throw error;
    }
  }

  /**
   * Shutdown communicator connection
   */
  public async shutdown(): Promise<void> {
    if (!this.active) {
      return;
    }

    try {
      // Disconnect all registered communicators
      const communicators = communicatorRegistry.getAll();

      for (const communicator of communicators) {
        if (communicator.driver.isConnected) {
          await communicator.driver.disconnect();
        }
      }

      // Clear the registry for clean restart
      communicatorRegistry.clear();

      this.active = false;
    } catch (error) {
      console.error("Failed to disconnect from communicator:", error);
      throw error;
    }
  }
}

import { ConnectorLifecyclePhase, ConnectorPriority } from "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";

//#region ../../@warlock.js/core/src/connectors/mail-connector.d.ts
/**
 * Mailer Connector
 * Manages mailer lifecycle and ensures graceful pool shutdown
 */
declare class MailerConnector extends BaseConnector {
  readonly name = "mailer";
  readonly priority = ConnectorPriority.MAILER;
  readonly lifecyclePhase = ConnectorLifecyclePhase.Early;
  /**
   * Files that trigger mailer restart
   */
  protected readonly watchedFiles: string[];
  /**
   * Initialize mailer configurations
   */
  start(): Promise<void>;
  /**
   * Shutdown mailer pool
   */
  shutdown(): Promise<void>;
}
//#endregion
export { MailerConnector };
//# sourceMappingURL=mail-connector.d.mts.map
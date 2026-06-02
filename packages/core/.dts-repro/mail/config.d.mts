import { MailConfigurations, MailMode, MailersConfig } from "./types.mjs";

//#region ../../@warlock.js/core/src/mail/config.d.ts
/**
 * Set the mail mode
 *
 * @param mode "production" | "development" | "test"
 *
 * - **production**: Actually sends emails via SMTP
 * - **development**: Logs emails to console without sending
 * - **test**: Captures emails to test mailbox for assertions
 *
 * @example
 * ```typescript
 * // In test setup
 * setMailMode("test");
 *
 * // In development
 * setMailMode("development");
 * ```
 */
declare function setMailMode(mode: MailMode): void;
/**
 * Get the current mail mode
 */
declare function getMailMode(): MailMode;
/**
 * Check if in production mode
 */
declare function isProductionMode(): boolean;
/**
 * Check if in development mode
 */
declare function isDevelopmentMode(): boolean;
/**
 * Check if in test mode
 */
declare function isTestMode(): boolean;
/**
 * Set mail configurations
 *
 * Supports both simple config and named mailers.
 *
 * @example
 * ```typescript
 * // Simple config (sets as default)
 * setMailConfigurations({
 *   host: "smtp.gmail.com",
 *   port: 587,
 *   username: "...",
 *   password: "...",
 * });
 *
 * // Named mailers
 * setMailConfigurations({
 *   default: { host: "smtp.sendgrid.net", ... },
 *   mailers: {
 *     marketing: { host: "smtp.mailchimp.com", ... },
 *     transactional: { host: "smtp.postmark.com", ... },
 *   },
 * });
 * ```
 */
declare function setMailConfigurations(config: MailConfigurations | MailersConfig): void;
declare function getDefaultMailConfig(): MailConfigurations;
/**
 * Get a named mailer configuration
 */
declare function getMailerConfig(name: string): MailConfigurations | undefined;
/**
 * Resolve configuration from options
 * Priority: config > mailer > default
 */
declare function resolveMailConfig(options: {
  config?: MailConfigurations;
  mailer?: string;
}): MailConfigurations;
/**
 * Reset all configurations (useful for testing)
 */
declare function resetMailConfig(): void;
//#endregion
export { getDefaultMailConfig, getMailMode, getMailerConfig, isDevelopmentMode, isProductionMode, isTestMode, resetMailConfig, resolveMailConfig, setMailConfigurations, setMailMode };
//# sourceMappingURL=config.d.mts.map
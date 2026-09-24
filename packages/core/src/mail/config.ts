import { config } from "../config";
import { environment } from "../utils/environment";
import type { MailConfigurations, MailersConfig, MailMode, SMTPConfigurations } from "./types";

/**
 * Default mail configurations
 */
const defaultConfigurations: Partial<SMTPConfigurations> = {
  tls: true,
  driver: "smtp",
};

/**
 * Merge defaults into an SMTP config.
 * `secure` is derived from the port when not set explicitly:
 * 465 uses implicit TLS, every other port (e.g. 587) uses STARTTLS.
 */
function withSmtpDefaults(config: MailConfigurations): SMTPConfigurations {
  const merged = { ...defaultConfigurations, ...config } as SMTPConfigurations;

  if (merged.secure === undefined) {
    merged.secure = Number(merged.port) === 465;
  }

  return merged;
}

/**
 * Mode set explicitly through `setMailMode`; when undefined the mode is
 * derived from the environment.
 */
let explicitMode: MailMode | undefined;

/**
 * Registered mailers configuration
 */
let mailersConfig: MailersConfig = {};

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
export function setMailMode(mode: MailMode): void {
  explicitMode = mode;
}

/**
 * Get the current mail mode
 */
export function getMailMode(): MailMode {
  if (explicitMode) return explicitMode;

  // Development and test never send real mail unless `mail.sendInDevelopment` is true
  if (environment() !== "production" && config.key("mail.sendInDevelopment") !== true) {
    return "development";
  }

  return "production";
}

/**
 * Check if in production mode
 */
export function isProductionMode(): boolean {
  return getMailMode() === "production";
}

/**
 * Check if in development mode
 */
export function isDevelopmentMode(): boolean {
  return getMailMode() === "development";
}

/**
 * Check if in test mode
 */
export function isTestMode(): boolean {
  return getMailMode() === "test";
}

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
export function setMailConfigurations(config: MailConfigurations | MailersConfig): void {
  // Check if it's a MailersConfig (has 'default' or 'mailers' key)
  if ("default" in config || "mailers" in config) {
    mailersConfig = config as MailersConfig;
  } else {
    // Simple config - set as default
    mailersConfig = {
      default: config as MailConfigurations,
    };
  }
}

export function getDefaultMailConfig(): MailConfigurations {
  const config = mailersConfig.default;
  if (!config) return {} as MailConfigurations;
  if ("driver" in config && config.driver === "ses") return config;

  return withSmtpDefaults(config);
}

/**
 * Get a named mailer configuration
 */
export function getMailerConfig(name: string): MailConfigurations | undefined {
  if (name === "default") {
    return getDefaultMailConfig();
  }

  const config = mailersConfig.mailers?.[name];
  if (!config) {
    return undefined;
  }

  if ("driver" in config && config.driver === "ses") return config;

  return withSmtpDefaults(config);
}

/**
 * Resolve configuration from options
 * Priority: config > mailer > default
 */
export function resolveMailConfig(options: {
  config?: MailConfigurations;
  mailer?: string;
}): MailConfigurations {
  if (options.config) {
    // SES config passes through as-is, no defaultConfigurations merge
    if ("driver" in options.config && options.config.driver === "ses") {
      return options.config;
    }

    return withSmtpDefaults(options.config);
  }

  if (options.mailer) {
    const config = getMailerConfig(options.mailer);
    if (!config) {
      throw new Error(`Mailer "${options.mailer}" not found in configuration`);
    }
    return config;
  }

  return getDefaultMailConfig();
}

/**
 * Reset all configurations (useful for testing)
 */
export function resetMailConfig(): void {
  explicitMode = undefined;
  mailersConfig = {};
}

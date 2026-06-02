import { MailConfigurations } from "./types.mjs";
import { Transporter } from "nodemailer";

//#region ../../@warlock.js/core/src/mail/mailer-pool.d.ts
/**
 * Get or create a mailer transporter from the pool
 * Nodemailer is eagerly loaded at import time
 */
declare function getMailer(config: MailConfigurations): Promise<Transporter>;
/**
 * Verify a mailer connection
 */
declare function verifyMailer(config: MailConfigurations): Promise<boolean>;
/**
 * Close a specific mailer connection
 */
declare function closeMailer(config: MailConfigurations): void;
/**
 * Close all mailer connections
 */
declare function closeAllMailers(): void;
/**
 * Get pool statistics
 */
declare function getPoolStats(): {
  size: number;
  hashes: string[];
};
//#endregion
export { closeAllMailers, closeMailer, getMailer, getPoolStats, verifyMailer };
//# sourceMappingURL=mailer-pool.d.mts.map
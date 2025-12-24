import { log } from "@warlock.js/logger";
import nodemailer, { type Transporter } from "nodemailer";
import type { MailConfigurations } from "./types";

/**
 * Mailer pool for connection reuse
 * Maps config hash to transporter instance
 */
const mailerPool = new Map<string, Transporter>();

/**
 * Create a hash from mail configuration for pooling
 */
function createConfigHash(config: MailConfigurations): string {
  const key = JSON.stringify({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    username: config.username,
    password: config.password,
  });

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }

  return `mailer_${hash}`;
}

/**
 * Get or create a mailer transporter from the pool
 */
export function getMailer(config: MailConfigurations): Transporter {
  const hash = createConfigHash(config);

  // Return existing transporter if available
  let transporter = mailerPool.get(hash);

  if (transporter) {
    return transporter;
  }

  // Create new transporter
  log.info("mail", "pool", `Creating new mailer transport (pool size: ${mailerPool.size + 1})`);

  const { auth, username, password, requireTLS, tls, ...transportConfig } = config;

  transporter = nodemailer.createTransport({
    requireTLS: requireTLS ?? tls,
    auth: auth ?? {
      user: username,
      pass: password,
    },
    ...transportConfig,
  });

  // Store in pool
  mailerPool.set(hash, transporter);

  return transporter;
}

/**
 * Verify a mailer connection
 */
export async function verifyMailer(config: MailConfigurations): Promise<boolean> {
  const transporter = getMailer(config);

  try {
    await transporter.verify();
    return true;
  } catch {
    return false;
  }
}

/**
 * Close a specific mailer connection
 */
export function closeMailer(config: MailConfigurations): void {
  const hash = createConfigHash(config);
  const transporter = mailerPool.get(hash);

  if (transporter) {
    transporter.close();
    mailerPool.delete(hash);
    log.info("mail", "pool", `Closed mailer transport (pool size: ${mailerPool.size})`);
  }
}

/**
 * Close all mailer connections
 */
export function closeAllMailers(): void {
  for (const [hash, transporter] of mailerPool) {
    transporter.close();
    mailerPool.delete(hash);
  }

  log.info("mail", "pool", "Closed all mailer transports");
}

/**
 * Get pool statistics
 */
export function getPoolStats(): { size: number; hashes: string[] } {
  return {
    size: mailerPool.size,
    hashes: Array.from(mailerPool.keys()),
  };
}

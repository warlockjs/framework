const CONFIG_FILE_PATTERN = /^src\/config\/(.+)\.(ts|tsx)$/;

/**
 * The key a config file is registered under, from its project-relative path.
 * The single naming rule shared by dev, the production builder and typings:
 * the raw path under `src/config`, extension dropped, nothing case-converted.
 *
 * @example
 * configKeyFromPath("src/config/rate-limit.ts"); // "rate-limit"
 * configKeyFromPath("src/config/mail/smtp.ts"); // "mail/smtp"
 *
 * @returns the key, or `undefined` when the path is not a config file
 */
export function configKeyFromPath(relativePath: string): string | undefined {
  return CONFIG_FILE_PATTERN.exec(relativePath.replace(/\\/g, "/"))?.[1];
}

import { R2StorageDriverOptions } from "../types.mjs";
import { CloudDriver } from "./cloud-driver.mjs";

//#region ../../@warlock.js/core/src/storage/drivers/r2-driver.d.ts
/**
 * Cloudflare R2 Storage Driver
 *
 * R2 is S3-compatible but uses a different URL structure and doesn't require regions.
 *
 * URL Patterns:
 * - With publicDomain: https://{publicDomain}/{key}
 * - With urlPrefix: {urlPrefix}/{key}
 * - Default public bucket: https://pub-{accountId}.r2.dev/{key}
 *
 * @example
 * ```typescript
 * const driver = new R2Driver({
 *   bucket: "my-bucket",
 *   region: "auto", // R2 doesn't use traditional regions
 *   accessKeyId: process.env.R2_ACCESS_KEY_ID,
 *   secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
 *   accountId: process.env.R2_ACCOUNT_ID,
 *   publicDomain: "assets.example.com", // Optional custom domain
 * });
 * ```
 */
declare class R2Driver extends CloudDriver<R2StorageDriverOptions> {
  /**
   * Driver name
   */
  readonly name = "r2";
  /**
   * Get R2 endpoint URL
   *
   * R2 endpoint format: https://{accountId}.r2.cloudflarestorage.com
   */
  protected getEndpoint(): string;
  /**
   * Get public URL for file
   *
   * Priority: urlPrefix > publicDomain > default R2 URL
   *
   * Note: For R2 public access, you typically need to:
   * - Enable public access on the bucket
   * - Or use a custom domain through Cloudflare
   */
  url(location: string): string;
}
//#endregion
export { R2Driver };
//# sourceMappingURL=r2-driver.d.mts.map
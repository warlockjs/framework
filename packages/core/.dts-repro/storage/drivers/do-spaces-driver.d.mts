import { CloudStorageDriverOptions } from "../types.mjs";
import { CloudDriver } from "./cloud-driver.mjs";

//#region ../../@warlock.js/core/src/storage/drivers/do-spaces-driver.d.ts
/**
 * DigitalOcean Spaces Storage Driver
 *
 * Spaces is S3-compatible with a different URL structure.
 *
 * URL Patterns:
 * - With urlPrefix: {urlPrefix}/{key}
 * - CDN URL: https://{bucket}.{region}.cdn.digitaloceanspaces.com/{key}
 * - Origin URL: https://{bucket}.{region}.digitaloceanspaces.com/{key}
 *
 * Regions: nyc3, sfo3, ams3, sgp1, fra1, etc.
 *
 * @example
 * ```typescript
 * const driver = new DOSpacesDriver({
 *   bucket: "my-space",
 *   region: "nyc3",
 *   accessKeyId: process.env.DO_SPACES_KEY,
 *   secretAccessKey: process.env.DO_SPACES_SECRET,
 * });
 * ```
 */
declare class DOSpacesDriver extends CloudDriver<CloudStorageDriverOptions> {
  /**
   * Driver name
   */
  readonly name = "spaces";
  /**
   * Get Spaces endpoint URL
   *
   * Spaces endpoint format: https://{region}.digitaloceanspaces.com
   */
  protected getEndpoint(): string;
  /**
   * Get public URL for file
   *
   * Note: DO Spaces includes automatic CDN with the `.cdn.` subdomain
   */
  url(location: string): string;
}
//#endregion
export { DOSpacesDriver };
//# sourceMappingURL=do-spaces-driver.d.mts.map
import { CloudStorageDriverOptions } from "../types.mjs";
import { CloudDriver } from "./cloud-driver.mjs";

//#region ../../@warlock.js/core/src/storage/drivers/s3-driver.d.ts
/**
 * AWS S3 Storage Driver
 *
 * URL Pattern: https://{bucket}.s3.{region}.amazonaws.com/{key}
 *
 * @example
 * ```typescript
 * const driver = new S3Driver({
 *   bucket: "my-bucket",
 *   region: "us-east-1",
 *   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
 *   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
 * });
 * ```
 */
declare class S3Driver extends CloudDriver<CloudStorageDriverOptions> {
  /**
   * Driver name
   */
  readonly name = "s3";
  /**
   * Get public URL for file
   *
   * URL formats:
   * - With urlPrefix: {urlPrefix}/{key}
   * - Default: https://{bucket}.s3.{region}.amazonaws.com/{key}
   */
  url(location: string): string;
}
//#endregion
export { S3Driver };
//# sourceMappingURL=s3-driver.d.mts.map
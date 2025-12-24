import type { CloudStorageDriverOptions } from "../types";
import { CloudDriver } from "./cloud-driver";

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
export class S3Driver extends CloudDriver<CloudStorageDriverOptions> {
  /**
   * Driver name
   */
  public readonly name = "s3";

  /**
   * Get public URL for file
   *
   * URL formats:
   * - With urlPrefix: {urlPrefix}/{key}
   * - Default: https://{bucket}.s3.{region}.amazonaws.com/{key}
   */
  public url(location: string): string {
    if (this.options.urlPrefix) {
      return `${this.options.urlPrefix}/${location}`;
    }

    return `https://${this.options.bucket}.s3.${this.options.region}.amazonaws.com/${location}`;
  }
}

/**
 * Thrown when the `uploads.images` configuration is invalid.
 *
 * Raised the first time a variant is requested, so a bad config fails loudly
 * on the first image instead of producing unbounded or surprising derivatives.
 */
export class ImageVariantsConfigError extends Error {
  /** Stable Warlock error code; `warlock explain WL1005` prints the fix. */
  public readonly code = "WL1005";

  public constructor(message: string) {
    super(`Invalid uploads.images configuration: ${message}`);

    this.name = "ImageVariantsConfigError";
  }
}

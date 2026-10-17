/**
 * Thrown when the `uploads.images` configuration is invalid.
 *
 * Raised the first time a variant is requested, so a bad config fails loudly
 * on the first image instead of producing unbounded or surprising derivatives.
 */
export class ImageVariantsConfigError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(`Invalid uploads.images configuration: ${message}`, options);

    this.name = "ImageVariantsConfigError";
  }
}

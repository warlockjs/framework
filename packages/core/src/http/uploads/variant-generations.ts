import { SingleFlight } from "./single-flight";

/**
 * Shared in-process single-flight for derivative generation.
 *
 * Both `uploadedFileController` and `generateImageVariants` run generations
 * through this one instance, so concurrent misses for the same cache key —
 * whether they arrive from the on-demand route or from an ingest call —
 * render the derivative once.
 */
export const variantGenerations = new SingleFlight<void>();

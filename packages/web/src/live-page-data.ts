/** Page loader dependencies; independent of whether its response is cached. */
export type LivePageOptions = {
  readonly tags: readonly string[];
  /** Fallback polling interval in milliseconds. Defaults to 30,000. */
  readonly pollInterval?: number;
};

export const PAGE_INVALIDATED_EVENT = "warlock:page-invalidated";
export const LIVE_PAGE_REQUEST_HEADER = "x-warlock-live";

/** Shared validation for authored configuration and the hydration wire. */
export function isLivePageOptions(value: unknown): value is LivePageOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const options = value as Record<string, unknown>;

  return (
    Object.keys(options).every((key) => key === "tags" || key === "pollInterval") &&
    Array.isArray(options.tags) &&
    options.tags.length > 0 &&
    options.tags.every((tag: unknown) => typeof tag === "string" && tag.trim() !== "") &&
    (options.pollInterval === undefined ||
      (typeof options.pollInterval === "number" &&
        Number.isFinite(options.pollInterval) &&
        options.pollInterval >= 1 &&
        options.pollInterval <= 2_147_483_647))
  );
}

import type { DevtoolsSampleSummary } from "../contracts";
import type { DevtoolsSampleFilter } from "../store/types";

/** Whether a stored sample's row passes a request filter (the same rules as the store). */
export function sampleMatchesFilter(
  summary: DevtoolsSampleSummary,
  filter: DevtoolsSampleFilter,
): boolean {
  if (filter.status !== undefined && !statusMatches(filter.status, summary.status)) return false;

  if (filter.method !== undefined && summary.method.toUpperCase() !== filter.method.toUpperCase()) {
    return false;
  }

  if (filter.route !== undefined) {
    const haystack = `${summary.route ?? ""} ${summary.path}`.toLowerCase();

    if (!haystack.includes(filter.route.toLowerCase())) return false;
  }

  if (filter.q !== undefined && !summary.path.toLowerCase().includes(filter.q.toLowerCase())) {
    return false;
  }

  if (filter.since !== undefined && summary.startedAt < filter.since) return false;
  if (filter.until !== undefined && summary.startedAt > filter.until) return false;
  if (filter.instance !== undefined && summary.instance !== filter.instance) return false;

  return true;
}

function statusMatches(filter: string, status: number | undefined): boolean {
  if (status === undefined) return false;

  const range = /^([1-5])xx$/i.exec(filter);

  if (range) return Math.floor(status / 100) === Number(range[1]);

  return status === Number(filter);
}

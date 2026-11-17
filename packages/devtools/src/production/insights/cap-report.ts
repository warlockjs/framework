import type { DevtoolsInstanceReport } from "../contracts";

type ListSetter = (report: DevtoolsInstanceReport, keep: number) => DevtoolsInstanceReport;

const sizeOf = (report: DevtoolsInstanceReport): number =>
  Buffer.byteLength(JSON.stringify(report), "utf8");

/** The lists to trim, in order, with how to cut each one to its first `keep` entries. */
const LISTS: { length(report: DevtoolsInstanceReport): number; cut: ListSetter }[] = [
  { length: (r) => r.logs.length, cut: (r, keep) => ({ ...r, logs: r.logs.slice(0, keep) }) },
  { length: (r) => r.errors.length, cut: (r, keep) => ({ ...r, errors: r.errors.slice(0, keep) }) },
  { length: (r) => r.routes.length, cut: (r, keep) => ({ ...r, routes: r.routes.slice(0, keep) }) },
  {
    length: (r) => r.queries.length,
    cut: (r, keep) => ({ ...r, queries: r.queries.slice(0, keep) }),
  },
  {
    length: (r) => r.resources.history.length,
    cut: (r, keep) => ({
      ...r,
      resources: { ...r.resources, history: r.resources.history.slice(0, keep) },
    }),
  },
];

/**
 * Trims a report's lists from the end until its JSON is at most `maxBytes`
 * (default 256 KB): logs first, then errors, routes, queries and the
 * resource history. A report that already fits is returned unchanged.
 */
export function capReportSize(
  report: DevtoolsInstanceReport,
  maxBytes = 262_144,
): DevtoolsInstanceReport {
  let current = report;

  for (const list of LISTS) {
    if (sizeOf(current) <= maxBytes) return current;

    // The largest number of entries to keep that fits (0 when none does).
    let low = 0;
    let high = list.length(current);

    while (low < high) {
      const middle = Math.ceil((low + high) / 2);

      if (sizeOf(list.cut(current, middle)) <= maxBytes) low = middle;
      else high = middle - 1;
    }

    current = list.cut(current, low);
  }

  return current;
}

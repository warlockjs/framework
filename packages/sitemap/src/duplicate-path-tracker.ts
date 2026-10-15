import type { DuplicateReport } from "./types";

/**
 * The streaming equivalent of `Sitemap`'s `routesByPath` map. A streaming
 * writer cannot compare an entry against 500K predecessors, so it keeps only
 * the paths (and contributing routes) it has already seen. A duplicate is
 * SKIPPED here, not last-wins — the earlier one is already on disk.
 */
export class DuplicatePathTracker {
  private readonly routesByPath = new Map<string, (string | undefined)[]>();

  /** Records an attempt to write `path`. Returns `false` when it was already seen — skip it. */
  public attempt(path: string, route: string | undefined): boolean {
    const seen = this.routesByPath.get(path);

    if (seen) {
      seen.push(route);

      return false;
    }

    this.routesByPath.set(path, [route]);

    return true;
  }

  public report(): DuplicateReport[] {
    const reports: DuplicateReport[] = [];

    for (const [path, routes] of this.routesByPath) {
      if (routes.length < 2) continue;

      reports.push({ path, count: routes.length, routes: [...routes] });
    }

    return reports;
  }
}

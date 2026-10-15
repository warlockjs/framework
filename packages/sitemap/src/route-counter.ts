import type { RouteSummary } from "./types";

/** Counts URLs actually written per declared route, across every shard of every group. */
export class RouteCounter {
  private readonly counts = new Map<string, number>();

  public record(route: string | undefined): void {
    if (route === undefined) return;

    this.counts.set(route, (this.counts.get(route) ?? 0) + 1);
  }

  public summary(): RouteSummary[] {
    return [...this.counts].map(([route, count]) => ({ route, count }));
  }
}

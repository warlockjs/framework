import type { DevtoolsErrorsView } from "./production/contracts";
import type { DevtoolsPanelErrorSummary } from "./types";

/** Captured errors are offered to panels for the last hour. */
const WINDOW_MS = 3_600_000;

/** The most error groups one read maps. */
const MAX_GROUPS = 500;

/** The part of the insights a panel's error counts come from. */
type ErrorInsights = {
  errors(query: { instance: string; limit: number }): Promise<DevtoolsErrorsView>;
};

/**
 * What a panel factory receives as `context.errors`. Panels load before the
 * capture starts, so this reads through a source the connector binds once the
 * insights exist; until then (and when they never start) it answers an empty
 * list. Only counts, the route and the class name leave: no message, no stack.
 */
export type PanelErrorSource = {
  read: () => Promise<readonly DevtoolsPanelErrorSummary[]>;
  /** Binds the insights (development: this process; production: every instance). */
  bind(insights: ErrorInsights | null): void;
};

export function createPanelErrorSource(now: () => number = Date.now): PanelErrorSource {
  let insights: ErrorInsights | null = null;

  return {
    bind(next) {
      insights = next;
    },
    async read() {
      if (insights === null) return [];

      const since = now() - WINDOW_MS;
      const view = await insights.errors({ instance: "all", limit: MAX_GROUPS });

      return view.groups
        .filter((group) => group.lastSeen >= since)
        .map((group) => ({
          route: group.route,
          status: group.status,
          name: group.name,
          source: group.source,
          count: group.count,
          firstSeen: group.firstSeen,
          lastSeen: group.lastSeen,
        }));
    },
  };
}

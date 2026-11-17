import type {
  DevtoolsErrorGroup,
  DevtoolsQueryShapeStats,
  DevtoolsRoutePhaseStats,
  DevtoolsRouteStats,
} from "../contracts";
import { mergeHistograms } from "./histogram";

/** The later of two "slowest" records. */
function slower<T extends { durationMs: number }>(a: T | null, b: T | null): T | null {
  if (a === null) return b;
  if (b === null) return a;

  return b.durationMs > a.durationMs ? b : a;
}

/**
 * Merges the query statistics several instances reported: one row per shape
 * id, counts and histograms summed, the slowest example kept, `instances`
 * listing who reported it. Order: highest total time first.
 */
export function mergeQueryShapeStats(
  reports: readonly { instance: string; shapes: readonly DevtoolsQueryShapeStats[] }[],
): (DevtoolsQueryShapeStats & { instances: string[] })[] {
  const merged = new Map<string, DevtoolsQueryShapeStats & { instances: string[] }>();

  for (const { instance, shapes } of reports) {
    for (const shape of shapes) {
      const current = merged.get(shape.id);

      if (!current) {
        merged.set(shape.id, { ...structuredClone(shape), instances: [instance] });
        continue;
      }

      current.count += shape.count;
      current.errors += shape.errors;
      current.histogram = mergeHistograms([current.histogram, shape.histogram]);
      current.nPlusOne = {
        requests: current.nPlusOne.requests + shape.nPlusOne.requests,
        maxPerRequest: Math.max(current.nPlusOne.maxPerRequest, shape.nPlusOne.maxPerRequest),
      };
      current.slowest = slower(current.slowest, shape.slowest);
      current.firstSeen = Math.min(current.firstSeen, shape.firstSeen);
      current.lastSeen = Math.max(current.lastSeen, shape.lastSeen);
      current.explainable = current.explainable || shape.explainable;

      if (!current.instances.includes(instance)) current.instances.push(instance);
    }
  }

  return [...merged.values()].sort((a, b) => b.histogram.sumMs - a.histogram.sumMs);
}

/** Merges phase lists by name (counts and sums added, max kept), slowest total first, at most 30. */
function mergePhases(
  lists: readonly (readonly DevtoolsRoutePhaseStats[])[],
): DevtoolsRoutePhaseStats[] {
  const merged = new Map<string, DevtoolsRoutePhaseStats>();

  for (const list of lists) {
    for (const phase of list) {
      const current = merged.get(phase.name);

      if (!current) {
        merged.set(phase.name, { ...phase });
        continue;
      }

      current.count += phase.count;
      current.sumMs += phase.sumMs;
      current.maxMs = Math.max(current.maxMs, phase.maxMs);
    }
  }

  return [...merged.values()].sort((a, b) => b.sumMs - a.sumMs).slice(0, 30);
}

/** Merges route statistics by key, like `mergeQueryShapeStats`. */
export function mergeRouteStats(
  reports: readonly { instance: string; routes: readonly DevtoolsRouteStats[] }[],
): (DevtoolsRouteStats & { instances: string[] })[] {
  const merged = new Map<string, DevtoolsRouteStats & { instances: string[] }>();

  for (const { instance, routes } of reports) {
    for (const route of routes) {
      const current = merged.get(route.key);

      if (!current) {
        merged.set(route.key, { ...structuredClone(route), instances: [instance] });
        continue;
      }

      current.count += route.count;
      current.errors += route.errors;
      current.histogram = mergeHistograms([current.histogram, route.histogram]);
      current.phases = mergePhases([current.phases, route.phases]);
      current.slowest = slower(current.slowest, route.slowest);

      if (!current.instances.includes(instance)) current.instances.push(instance);
    }
  }

  return [...merged.values()].sort((a, b) => b.histogram.sumMs - a.histogram.sumMs);
}

/** Merges error groups by id: counts added, the newest message/stack kept. Newest first. */
export function mergeErrorGroups(
  reports: readonly { instance: string; errors: readonly DevtoolsErrorGroup[] }[],
): (DevtoolsErrorGroup & { instances: string[] })[] {
  const merged = new Map<string, DevtoolsErrorGroup & { instances: string[] }>();

  for (const { instance, errors } of reports) {
    for (const group of errors) {
      const current = merged.get(group.id);

      if (!current) {
        merged.set(group.id, { ...structuredClone(group), instances: [instance] });
        continue;
      }

      const newer = group.lastSeen > current.lastSeen;

      current.count += group.count;
      current.firstSeen = Math.min(current.firstSeen, group.firstSeen);

      if (newer) {
        current.lastSeen = group.lastSeen;
        current.message = group.message;
        current.stack = group.stack;
        current.status = group.status;
        current.lastRequestId = group.lastRequestId;
      }

      if (!current.instances.includes(instance)) current.instances.push(instance);
    }
  }

  return [...merged.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

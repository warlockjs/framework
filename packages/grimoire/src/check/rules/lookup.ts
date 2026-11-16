import type { GrimoireSnapshot } from "../../contracts/snapshot";
import type { WrittenFeature, WrittenFlow, WrittenStatus } from "../../contracts/written";

/** Written features and flows by id, for the rules. */
export type WrittenLookup = {
  features: Map<string, WrittenFeature>;
  /** By `<feature>/<flow>`. */
  flows: Map<string, WrittenFlow>;
  /** App ids that have a folder under `grimoire/apps/`. */
  apps: Set<string>;
};

/** Index the written files of a snapshot. */
export function writtenLookup(snapshot: GrimoireSnapshot): WrittenLookup {
  const features = new Map<string, WrittenFeature>();
  const flows = new Map<string, WrittenFlow>();

  for (const feature of snapshot.written.features) {
    features.set(feature.id, feature);

    for (const flow of feature.flows) flows.set(`${feature.id}/${flow.id.value}`, flow);
  }

  return { features, flows, apps: new Set(snapshot.written.apps.map((app) => app.id.value)) };
}

/** The README status of a feature, or `null` without a README. */
export function featureStatus(feature: WrittenFeature): WrittenStatus | null {
  return feature.readme?.status.value ?? null;
}

/**
 * Whether the code of a flow is gone on purpose: the flow or its whole
 * feature is `retired`. Rules that look a flow's names up in the code skip it.
 */
export function isRetired(feature: WrittenFeature, flow: WrittenFlow): boolean {
  return flow.status.value === "retired" || featureStatus(feature) === "retired";
}

/** `<whole>.<decimal>` as two numbers, or `null` for another form. */
export function parseVersion(value: string): [number, number] | null {
  const match = /^(\d+)\.(\d+)$/.exec(value.trim());

  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** Negative when `left` is older, positive when newer, 0 when equal. Malformed versions sort first. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left) ?? [-1, -1];
  const b = parseVersion(right) ?? [-1, -1];

  return a[0] - b[0] || a[1] - b[1];
}

/**
 * GR4017-GR4019: changes since the approved baseline, and rejected changes still there.
 */
import { createFinding } from "../../codes";
import type { GrimoireFinding } from "../../contracts/findings";
import type { DriftItem } from "../../contracts/shots";
import type { GrimoireSnapshot } from "../../contracts/snapshot";

const DESCRIPTION: Record<DriftItem["type"], string> = {
  "shot-changed": "the capture differs from the approved image",
  "shot-added": "the capture has no approved image yet",
  "shot-removed": "the approved image no longer has a scene",
  "flow-added": "the flow is new",
  "flow-removed": "the flow is gone",
  "criterion-added": "the criterion is new",
  "criterion-removed": "the criterion is gone",
  "criterion-changed": "the criterion's text changed",
  "case-added": "the case is new",
  "case-removed": "the case is gone",
  "proof-removed": "the criterion lost its proving test",
};

function describe(item: DriftItem): string {
  const where = [
    item.ref,
    item.criterion,
    item.language === null || item.language === "" ? null : item.language,
    item.case === null ? null : `"${item.case}"`,
  ]
    .filter((part) => part !== null)
    .join(" ");
  const text =
    item.type === "criterion-changed" && item.before !== null && item.after !== null
      ? ` (${JSON.stringify(item.before)} became ${JSON.stringify(item.after)})`
      : "";

  return `${where}: ${DESCRIPTION[item.type]}${text}`;
}

export function checkDrift(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const findings: GrimoireFinding[] = [];

  for (const item of snapshot.shots?.drift ?? []) {
    const flow = item.ref;
    const feature = flow.split("/")[0] ?? null;
    const reason = describe(item);

    if (item.rejected !== null) {
      findings.push(
        createFinding({
          code: "GR4019",
          message: `change ${item.id} was rejected${item.rejected.note === null ? "" : ` (${item.rejected.note})`} and is still there: ${reason}`,
          feature,
          flow,
        }),
      );
    } else {
      findings.push(
        createFinding({
          code: item.type.startsWith("shot-") ? "GR4017" : "GR4018",
          message: `${reason} (change ${item.id}, not approved)`,
          feature,
          flow,
        }),
      );
    }
  }

  return findings;
}

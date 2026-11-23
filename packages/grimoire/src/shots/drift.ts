/**
 * Drift: the current state of the flows, proving tests and captures against
 * the approved baseline. Ids are `<type>:<feature>/<flow>[:<AC-n>][:<language>|:<case>]`.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  ApprovedBaseline,
  ApprovedFlow,
  DriftItem,
  DriftType,
  ShotCaptureIndex,
  ShowsLine,
} from "../contracts/shots";
import type { ProofLine } from "../contracts/test-results";
import type { WrittenGrimoire } from "../contracts/written";
import { GRIMOIRE_PATHS } from "../paths";
import { comparePng } from "./png";

/** Everything drift reads. */
export type DriftInput = {
  root: string;
  written: WrittenGrimoire;
  proofs: readonly ProofLine[];
  shows: readonly ShowsLine[];
  captures: ShotCaptureIndex | null;
  baseline: ApprovedBaseline;
  /** The languages scenes run in; `[]` for one unnamed language. */
  languages: readonly string[];
  /** Flows opted out of captures. */
  optedOut: readonly string[];
};

/** The flows of a written grimoire in the shape the baseline stores. */
export function currentFlows(written: WrittenGrimoire): ApprovedFlow[] {
  return written.features
    .flatMap((feature) => feature.flows)
    .map((flow) => ({
      ref: flow.ref,
      criteria: flow.criteria.map((criterion) => ({ id: criterion.id, text: criterion.text })),
      cases: [...new Set(flow.cases.map((entry) => entry.question))],
    }))
    .sort((left, right) => left.ref.localeCompare(right.ref));
}

/** The id of a drift item. */
export function driftId(
  type: DriftType,
  ref: string,
  criterion: string | null,
  extra: string | null,
): string {
  return [type, ref, criterion, extra === "" ? null : extra].filter((part) => part !== null).join(":");
}

function item(
  baseline: ApprovedBaseline,
  fields: { type: DriftType; ref: string } & Partial<Omit<DriftItem, "id" | "rejected" | "type" | "ref">>,
): DriftItem {
  const criterion = fields.criterion ?? null;
  const extra = fields.language ?? fields.case ?? null;
  const id = driftId(fields.type, fields.ref, criterion, extra);

  return {
    id,
    type: fields.type,
    ref: fields.ref,
    criterion,
    language: fields.language ?? null,
    case: fields.case ?? null,
    before: fields.before ?? null,
    after: fields.after ?? null,
    approvedShot: fields.approvedShot ?? null,
    capturedShot: fields.capturedShot ?? null,
    rejected: baseline.rejected.find((entry) => entry.id === id) ?? null,
  };
}

async function readImage(root: string, file: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path.join(root, ...GRIMOIRE_PATHS.screenshots.split("/"), ...file.split("/")));
  } catch {
    return null;
  }
}

/** The differences of the current state from the approved baseline, in a stable order. */
export async function computeDrift(input: DriftInput): Promise<DriftItem[]> {
  const { baseline } = input;
  const items: DriftItem[] = [];
  const now = new Map(currentFlows(input.written).map((flow) => [flow.ref, flow]));
  const approved = new Map(baseline.flows.map((flow) => [flow.ref, flow]));

  for (const [ref, flow] of now) {
    const before = approved.get(ref);

    if (before === undefined) {
      items.push(item(baseline, { type: "flow-added", ref }));
      continue;
    }

    const beforeCriteria = new Map(before.criteria.map((criterion) => [criterion.id, criterion.text]));
    const nowCriteria = new Map(flow.criteria.map((criterion) => [criterion.id, criterion.text]));

    for (const [id, text] of nowCriteria) {
      const old = beforeCriteria.get(id);

      if (old === undefined) {
        items.push(item(baseline, { type: "criterion-added", ref, criterion: id, after: text }));
      } else if (old !== text) {
        items.push(
          item(baseline, { type: "criterion-changed", ref, criterion: id, before: old, after: text }),
        );
      }
    }

    for (const [id, text] of beforeCriteria) {
      if (!nowCriteria.has(id)) {
        items.push(item(baseline, { type: "criterion-removed", ref, criterion: id, before: text }));
      }
    }

    for (const question of flow.cases) {
      if (!before.cases.includes(question)) {
        items.push(item(baseline, { type: "case-added", ref, case: question, after: question }));
      }
    }

    for (const question of before.cases) {
      if (!flow.cases.includes(question)) {
        items.push(item(baseline, { type: "case-removed", ref, case: question, before: question }));
      }
    }
  }

  for (const ref of approved.keys()) {
    if (!now.has(ref)) items.push(item(baseline, { type: "flow-removed", ref }));
  }

  // A proving test is removed when the criterion has no `@proves` line left.
  const proven = new Set(input.proofs.map((proof) => `${proof.ref} ${proof.criterion}`));
  const seenProofs = new Set<string>();

  for (const proof of baseline.proofs) {
    const key = `${proof.ref} ${proof.criterion}`;

    if (proven.has(key) || seenProofs.has(key)) continue;

    seenProofs.add(key);
    // A removed flow or criterion is already reported by its own item.
    if (!now.get(proof.ref)?.criteria.some((criterion) => criterion.id === proof.criterion)) continue;

    items.push(
      item(baseline, {
        type: "proof-removed",
        ref: proof.ref,
        criterion: proof.criterion,
        before: proof.testName ?? proof.testFile,
      }),
    );
  }

  items.push(...(await shotDrift(input)));

  return items.sort(
    (left, right) =>
      left.ref.localeCompare(right.ref) ||
      (left.criterion ?? "").localeCompare(right.criterion ?? "", "en", { numeric: true }) ||
      left.id.localeCompare(right.id),
  );
}

async function shotDrift(input: DriftInput): Promise<DriftItem[]> {
  const { baseline } = input;
  const items: DriftItem[] = [];
  const shown = new Set(
    input.shows.filter((line) => line.call !== null).map((line) => `${line.ref} ${line.criterion}`),
  );
  const expected = input.languages.length > 0 ? input.languages : [""];
  const approved = new Map(
    baseline.shots.map((shot) => [`${shot.ref} ${shot.criterion} ${shot.language}`, shot]),
  );
  const captured = new Map(
    (input.captures?.captures ?? [])
      .filter((capture) => capture.outcome === "pass" && capture.file !== null)
      .map((capture) => [`${capture.ref} ${capture.criterion} ${capture.language}`, capture]),
  );

  for (const [key, capture] of captured) {
    if (!shown.has(`${capture.ref} ${capture.criterion}`) || input.optedOut.includes(capture.ref)) {
      continue;
    }

    const shot = approved.get(key);
    const base = { ref: capture.ref, criterion: capture.criterion, language: capture.language };

    if (shot === undefined) {
      items.push(item(baseline, { type: "shot-added", ...base, capturedShot: capture.file }));
      continue;
    }

    if (capture.sha256 === shot.sha256) continue;

    const [before, after] = await Promise.all([
      readImage(input.root, shot.file),
      readImage(input.root, capture.file ?? ""),
    ]);

    // A capture whose file is gone proves nothing; an approved image that is gone cannot be compared.
    if (after === null) continue;

    if (before === null || comparePng(before, after).changed) {
      items.push(
        item(baseline, {
          type: "shot-changed",
          ...base,
          approvedShot: shot.file,
          capturedShot: capture.file,
        }),
      );
    }
  }

  for (const [, shot] of approved) {
    const gone =
      !shown.has(`${shot.ref} ${shot.criterion}`) ||
      input.optedOut.includes(shot.ref) ||
      !expected.includes(shot.language);

    if (gone) {
      items.push(
        item(baseline, {
          type: "shot-removed",
          ref: shot.ref,
          criterion: shot.criterion,
          language: shot.language,
          approvedShot: shot.file,
        }),
      );
    }
  }

  return items;
}

/**
 * Approve and reject: the only code that writes `grimoire/approved/baseline.json`
 * and the images under `grimoire/screenshots/approved/`.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { GrimoireError } from "../codes";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type {
  ApprovedBaseline,
  ApprovedFlow,
  ApprovedProof,
  ApprovedShot,
  DriftItem,
} from "../contracts/shots";
import { criterionShotName, GRIMOIRE_PATHS } from "../paths";
import { currentFlows } from "./drift";
import { optedOutFlows } from "./state";
import { readBaseline, writeBaseline } from "./store";

/** What to approve or reject. */
export type ApprovalRequest = {
  /** Drift ids, or `<feature>/<flow>` (every item of the flow), or `all`. */
  targets: string[];
  /** Keep only the shot items of this language. */
  language?: string;
  /** Why (reject only). */
  note?: string;
};

const FLOW_REF = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A path under `grimoire/screenshots/`. The parts come from the baseline and
 * the capture index (files in the project), so a part that is empty, `.` or
 * `..`, or holds a separator, is refused: approving never reads, copies or
 * deletes a file outside that folder.
 */
function shotsRoot(root: string, ...parts: string[]): string {
  for (const part of parts) {
    if (part === "" || part === "." || part === ".." || /[\\/:]/.test(part)) {
      throw new GrimoireError(
        "GR9010",
        `The screenshot path ${JSON.stringify(parts.join("/"))} is not a path under ${GRIMOIRE_PATHS.screenshots}; correct ${GRIMOIRE_PATHS.baseline} or run the browser tests again.`,
      );
    }
  }

  return path.join(root, ...GRIMOIRE_PATHS.screenshots.split("/"), ...parts);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The drift items a request names. `GR9010` when a target matches nothing.
 * `all` with a language keeps only that language's shot items.
 */
export function selectDrift(snapshot: GrimoireSnapshot, request: ApprovalRequest): DriftItem[] {
  const drift = snapshot.shots?.drift ?? [];
  const chosen = new Map<string, DriftItem>();

  if (request.targets.length === 0) {
    throw new GrimoireError(
      "GR9010",
      "Name what to approve: a change id, a <feature>/<flow>, or --all.",
    );
  }

  for (const target of request.targets) {
    const matches =
      target === "all"
        ? drift
        : drift.filter(
            (entry) => entry.id === target || (FLOW_REF.test(target) && entry.ref === target),
          );
    const narrowed =
      request.language === undefined
        ? matches
        : matches.filter((entry) => entry.language === request.language);

    if (narrowed.length === 0 && target !== "all") {
      throw new GrimoireError(
        "GR9010",
        `Nothing to approve or reject matches ${JSON.stringify(target)}${request.language === undefined ? "" : ` in ${request.language}`}. Pass a change id from the Bird view or the check, a <feature>/<flow>, or --all.`,
      );
    }

    for (const entry of narrowed) chosen.set(entry.id, entry);
  }

  return [...chosen.values()];
}

/** The baseline of the current state: every flow, proving test and passing capture. */
async function baselineFromCurrent(
  root: string,
  snapshot: GrimoireSnapshot,
  now: string,
): Promise<ApprovedBaseline> {
  const baseline: ApprovedBaseline = {
    schemaVersion: 1,
    approvedAt: now,
    flows: currentFlows(snapshot.written),
    proofs: currentProofs(snapshot),
    shots: [],
    rejected: [],
  };
  const shown = new Set(
    (snapshot.shots?.shows ?? [])
      .filter((line) => line.call !== null)
      .map((line) => `${line.ref} ${line.criterion}`),
  );
  const optedOut = new Set(optedOutFlows(snapshot.written));

  for (const capture of snapshot.shots?.captures?.captures ?? []) {
    if (
      capture.outcome === "pass" &&
      capture.file !== null &&
      shown.has(`${capture.ref} ${capture.criterion}`) &&
      !optedOut.has(capture.ref)
    ) {
      baseline.shots.push(
        await approveImage(
          root,
          capture.ref,
          capture.criterion,
          capture.language,
          capture.file,
          now,
        ),
      );
    }
  }

  return baseline;
}

function currentProofs(snapshot: GrimoireSnapshot): ApprovedProof[] {
  const seen = new Set<string>();
  const proofs: ApprovedProof[] = [];

  for (const proof of snapshot.proofs) {
    if (proof.test === null) continue;

    const key = `${proof.ref} ${proof.criterion} ${proof.at.file}`;

    if (seen.has(key)) continue;

    seen.add(key);
    proofs.push({
      ref: proof.ref,
      criterion: proof.criterion,
      testFile: proof.at.file,
      testName: proof.test.name,
    });
  }

  return proofs;
}

/** Copy `captured/…` to `approved/…` and describe it. */
async function approveImage(
  root: string,
  ref: string,
  criterion: string,
  language: string,
  captured: string,
  now: string,
): Promise<ApprovedShot> {
  const source = shotsRoot(root, ...captured.split("/"));
  const file = `approved/${criterionShotName(ref, criterion, language)}`;
  const target = shotsRoot(root, ...file.split("/"));
  let bytes: Buffer;

  try {
    bytes = await readFile(source);
  } catch {
    throw new GrimoireError(
      "GR9010",
      `The capture ${GRIMOIRE_PATHS.screenshots}/${captured} is missing; run the browser tests again, then approve.`,
    );
  }

  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);

  return { ref, criterion, language, file, sha256: sha256(bytes), approvedAt: now };
}

function upsertFlow(baseline: ApprovedBaseline, flow: ApprovedFlow): void {
  baseline.flows = [...baseline.flows.filter((entry) => entry.ref !== flow.ref), flow].sort(
    (left, right) => left.ref.localeCompare(right.ref),
  );
}

/**
 * Approve `items` (the baseline is created from the current state when there
 * is none and `items` is empty with `createWhenMissing`). Returns the ids done.
 */
export async function approveItems(
  snapshot: GrimoireSnapshot,
  items: readonly DriftItem[],
  now = new Date().toISOString(),
  options: { createWhenMissing?: boolean } = {},
): Promise<string[]> {
  const root = snapshot.root;
  // Read from disk: the panel's snapshot may be a moment old, and an approval made since must not be lost.
  const existing = (await readBaseline(root)) ?? snapshot.shots?.baseline ?? null;

  if (existing === null) {
    if (options.createWhenMissing !== true) {
      throw new GrimoireError(
        "GR9010",
        "Nothing is approved yet; approve everything first (--all).",
      );
    }

    await writeBaseline(root, await baselineFromCurrent(root, snapshot, now));

    return ["baseline"];
  }

  const baseline: ApprovedBaseline = structuredClone(existing);
  const current = new Map(currentFlows(snapshot.written).map((flow) => [flow.ref, flow]));
  const captures = new Map(
    (snapshot.shots?.captures?.captures ?? []).map((capture) => [
      `${capture.ref} ${capture.criterion} ${capture.language}`,
      capture,
    ]),
  );
  const done: string[] = [];
  const removedProofs = new Set<string>();

  for (const item of items) {
    const flow = current.get(item.ref);
    const approvedFlow = baseline.flows.find((entry) => entry.ref === item.ref);

    switch (item.type) {
      case "shot-changed":
      case "shot-added": {
        const capture = captures.get(`${item.ref} ${item.criterion} ${item.language}`);

        if (capture?.file == null) {
          throw new GrimoireError(
            "GR9010",
            `The capture for ${item.id} is missing; run the browser tests again.`,
          );
        }

        const shot = await approveImage(
          root,
          item.ref,
          item.criterion ?? "",
          item.language ?? "",
          capture.file,
          now,
        );

        baseline.shots = [
          ...baseline.shots.filter(
            (entry) =>
              !(
                entry.ref === shot.ref &&
                entry.criterion === shot.criterion &&
                entry.language === shot.language
              ),
          ),
          shot,
        ];
        break;
      }
      case "shot-removed":
        if (item.approvedShot !== null) {
          await rm(shotsRoot(root, ...item.approvedShot.split("/")), { force: true });
        }

        baseline.shots = baseline.shots.filter(
          (entry) =>
            !(
              entry.ref === item.ref &&
              entry.criterion === item.criterion &&
              entry.language === item.language
            ),
        );
        break;
      case "flow-added":
        if (flow) upsertFlow(baseline, structuredClone(flow));
        break;
      case "flow-removed":
        baseline.flows = baseline.flows.filter((entry) => entry.ref !== item.ref);
        baseline.proofs = baseline.proofs.filter((entry) => entry.ref !== item.ref);
        break;
      case "criterion-added":
      case "criterion-changed": {
        const text = flow?.criteria.find((entry) => entry.id === item.criterion);

        if (!flow || !text) break;

        if (!approvedFlow) upsertFlow(baseline, structuredClone(flow));
        else {
          approvedFlow.criteria = [
            ...approvedFlow.criteria.filter((entry) => entry.id !== item.criterion),
            { ...text },
          ].sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
        }
        break;
      }
      case "criterion-removed":
        if (approvedFlow) {
          approvedFlow.criteria = approvedFlow.criteria.filter(
            (entry) => entry.id !== item.criterion,
          );
        }
        break;
      case "case-added":
        if (!flow) break;

        if (!approvedFlow) upsertFlow(baseline, structuredClone(flow));
        else if (item.case !== null && !approvedFlow.cases.includes(item.case)) {
          approvedFlow.cases = [...approvedFlow.cases, item.case];
        }
        break;
      case "case-removed":
        if (approvedFlow)
          approvedFlow.cases = approvedFlow.cases.filter((entry) => entry !== item.case);
        break;
      case "proof-removed":
        removedProofs.add(`${item.ref} ${item.criterion}`);
        break;
    }

    done.push(item.id);
  }

  // New proving tests are never drift; they join the baseline with the next approval.
  const proofs = currentProofs(snapshot);
  const proven = new Set(proofs.map((proof) => `${proof.ref} ${proof.criterion}`));

  baseline.proofs = [
    ...proofs,
    ...baseline.proofs.filter((proof) => {
      const key = `${proof.ref} ${proof.criterion}`;

      return !proven.has(key) && !removedProofs.has(key);
    }),
  ];
  baseline.rejected = baseline.rejected.filter((entry) => !done.includes(entry.id));
  baseline.approvedAt = now;

  await writeBaseline(root, baseline);

  return done;
}

/** Reject `items`: each stays an error (`GR4019`) while it is still there. Returns the ids done. */
export async function rejectItems(
  snapshot: GrimoireSnapshot,
  items: readonly DriftItem[],
  note: string | null,
  now = new Date().toISOString(),
): Promise<string[]> {
  const existing = (await readBaseline(snapshot.root)) ?? snapshot.shots?.baseline ?? null;

  if (existing === null) {
    throw new GrimoireError("GR9010", "Nothing is approved yet, so there is no change to reject.");
  }

  const ids = items.map((item) => item.id);
  const baseline: ApprovedBaseline = {
    ...structuredClone(existing),
    rejected: [
      ...existing.rejected.filter((entry) => !ids.includes(entry.id)),
      ...ids.map((id) => ({ id, rejectedAt: now, note })),
    ],
  };

  await writeBaseline(snapshot.root, baseline);

  return ids;
}

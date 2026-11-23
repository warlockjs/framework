/**
 * Reading and writing the two JSON files of visual proof: the capture index
 * (`grimoire/screenshots/captured/index.json`, Warlock, ignored by git) and
 * the approved baseline (`grimoire/approved/baseline.json`, in git, written
 * only by approve and reject).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ApprovedBaseline,
  ShotCapture,
  ShotCaptureIndex,
} from "../contracts/shots";
import { GRIMOIRE_PATHS } from "../paths";

function absolute(root: string, file: string): string {
  return path.join(root, ...file.split("/"));
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Write through a temporary file so a reader never sees half a file. */
async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });

  const temporary = `${file}.${process.pid}.tmp`;

  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

/** The key of a capture: one scene in one language. */
export function captureKey(ref: string, criterion: string, language: string): string {
  return `${ref} ${criterion} ${language}`;
}

/** The capture index, or `null` when no scene ever ran (or the file is not an index). */
export async function readCaptureIndex(root: string): Promise<ShotCaptureIndex | null> {
  const index = await readJson<ShotCaptureIndex>(absolute(root, GRIMOIRE_PATHS.captureIndex));

  return index !== null && index.schemaVersion === 1 && Array.isArray(index.captures)
    ? index
    : null;
}

export async function writeCaptureIndex(root: string, index: ShotCaptureIndex): Promise<void> {
  await writeJson(absolute(root, GRIMOIRE_PATHS.captureIndex), index);
}

/** The index with `ran` replacing the captures of the same scene and language; every other entry is kept. */
export function mergeCaptures(
  index: ShotCaptureIndex | null,
  ran: readonly ShotCapture[],
  now: string,
): ShotCaptureIndex {
  const replaced = new Set(ran.map((c) => captureKey(c.ref, c.criterion, c.language)));
  const kept = (index?.captures ?? []).filter(
    (capture) => !replaced.has(captureKey(capture.ref, capture.criterion, capture.language)),
  );
  const captures = [...kept, ...ran].sort(
    (left, right) =>
      left.ref.localeCompare(right.ref) ||
      left.criterion.localeCompare(right.criterion, "en", { numeric: true }) ||
      left.language.localeCompare(right.language),
  );

  return { schemaVersion: 1, updatedAt: now, captures };
}

/** The approved baseline, or `null` before the first approval. */
export async function readBaseline(root: string): Promise<ApprovedBaseline | null> {
  const baseline = await readJson<ApprovedBaseline>(absolute(root, GRIMOIRE_PATHS.baseline));

  return baseline !== null && baseline.schemaVersion === 1 && Array.isArray(baseline.flows)
    ? {
        ...baseline,
        proofs: baseline.proofs ?? [],
        shots: baseline.shots ?? [],
        rejected: baseline.rejected ?? [],
      }
    : null;
}

export async function writeBaseline(root: string, baseline: ApprovedBaseline): Promise<void> {
  await writeJson(absolute(root, GRIMOIRE_PATHS.baseline), baseline);
}

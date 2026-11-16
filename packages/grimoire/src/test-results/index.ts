/**
 * Test results per criterion: reading, merging, writing the store the Vitest
 * reporter fills, and the check rules over it (`GR4006`–`GR4008`).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createFinding } from "../codes";
import { GRIMOIRE_PATHS, toPosixPath } from "../paths";
import type { GrimoireFinding } from "../contracts/findings";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type { ProofResult, TestResultsStore } from "../contracts/test-results";

export { criterionStatus, type CriterionTestResult } from "./criterion-status";

/** sha256 (hex) of a test file's bytes: the value stored as `testFileHash`. */
export function hashTestFile(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Read `grimoire/book/test-results.json`; `null` when absent or unreadable. */
export async function readTestResults(root: string): Promise<TestResultsStore | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(path.join(root, GRIMOIRE_PATHS.testResults), "utf8"),
    );

    if (!isStore(parsed)) return null;

    return parsed;
  } catch {
    return null;
  }
}

function isStore(value: unknown): value is TestResultsStore {
  if (typeof value !== "object" || value === null) return false;

  const store = value as Partial<TestResultsStore>;

  return store.schemaVersion === 1 && Array.isArray(store.results);
}

function compareResults(a: ProofResult, b: ProofResult): number {
  if (a.testFile !== b.testFile) return a.testFile < b.testFile ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.feature !== b.feature) return a.feature < b.feature ? -1 : 1;
  if (a.flow !== b.flow) return a.flow < b.flow ? -1 : 1;

  return a.criterion < b.criterion ? -1 : a.criterion > b.criterion ? 1 : 0;
}

/**
 * Merge one run into the store: results of the test files the run covered
 * replace the old ones; results of other files stay. Pure.
 *
 * @param ranFiles Test files the run executed (even those with no proving test).
 */
export function mergeTestResults(
  store: TestResultsStore | null,
  run: readonly ProofResult[],
  ranFiles: readonly string[],
  now: Date,
): TestResultsStore {
  const ran = new Set([...ranFiles, ...run.map((result) => result.testFile)].map(toPosixPath));
  const kept = (store?.results ?? []).filter((result) => !ran.has(toPosixPath(result.testFile)));

  return {
    schemaVersion: 1,
    updatedAt: now.toISOString(),
    runner: "vitest",
    results: [...kept, ...run].sort(compareResults),
  };
}

/** Write the store (atomically: temp file, then rename). */
export async function writeTestResults(root: string, store: TestResultsStore): Promise<void> {
  const target = path.join(root, GRIMOIRE_PATHS.testResults);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;

  await mkdir(path.dirname(target), { recursive: true });

  try {
    await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });

    throw error;
  }
}

/** The GR4006–GR4008 rules. Read-only; nothing when no results exist. */
export function checkTestResults(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const store = snapshot.results;

  if (!store) return [];

  const proposed = new Set(
    snapshot.written.features.flatMap((feature) =>
      feature.flows.filter((flow) => flow.status.value === "proposed").map((flow) => flow.ref),
    ),
  );
  const hashes = new Map<string, string | null>();
  const currentHash = (file: string): string | null => {
    if (!hashes.has(file)) {
      try {
        hashes.set(file, hashTestFile(readFileSync(path.join(snapshot.root, file))));
      } catch {
        hashes.set(file, null);
      }
    }

    return hashes.get(file) ?? null;
  };
  const findings: GrimoireFinding[] = [];

  for (const proof of snapshot.proofs) {
    const file = toPosixPath(proof.at.file);
    const candidates = store.results.filter(
      (result) =>
        toPosixPath(result.testFile) === file &&
        result.feature === proof.feature &&
        result.flow === proof.flow &&
        result.criterion === proof.criterion,
    );
    const result = candidates.find((item) => item.outcome === "fail") ?? candidates[0];
    const label = `${proof.ref} ${proof.criterion}`;
    const base = { at: proof.at, feature: proof.feature, flow: proof.ref, file };
    let finding: GrimoireFinding | null = null;

    if (!result || result.outcome === "skip") {
      finding = createFinding({
        ...base,
        code: "GR4008",
        message: `${label}: its test did not run in the last run${proof.test?.name ? ` ("${proof.test.name}")` : ""}`,
      });
    } else if (result.outcome === "fail") {
      finding = createFinding({
        ...base,
        code: "GR4006",
        message: `${label}: its test failed in the last run ("${result.testName}")`,
      });
    } else {
      const hash = currentHash(file);

      if (hash !== null && hash !== result.testFileHash) {
        finding = createFinding({
          ...base,
          code: "GR4007",
          message: `${label}: its result is older than ${file} (ran ${result.ranAt})`,
        });
      }
    }

    if (finding) {
      if (proposed.has(proof.ref)) finding.expected = true;

      findings.push(finding);
    }
  }

  return findings;
}

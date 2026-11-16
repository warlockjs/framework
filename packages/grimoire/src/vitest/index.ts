/**
 * `@warlock.js/grimoire/vitest`: a Vitest reporter that records the outcome
 * of every test proving a criterion in `grimoire/book/test-results.json`.
 *
 * ```ts
 * // vitest.config.ts
 * import { grimoireReporter } from "@warlock.js/grimoire/vitest";
 *
 * export default defineConfig({ test: { reporters: ["default", grimoireReporter()] } });
 * ```
 *
 * Framework-neutral: this entry must not import `@warlock.js/core`,
 * `@warlock.js/web` or `vitest` at runtime (the reporter is typed structurally).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  ProofLine,
  ProofResult,
  TestOutcome,
  TestResultsStore,
} from "../contracts/test-results";
import { toPosixPath } from "../paths";
import { scanProofsInText } from "../proves";
import { hashTestFile, mergeTestResults, readTestResults, writeTestResults } from "../test-results";

/** Options of `grimoireReporter()`. */
export type GrimoireReporterOptions = {
  /** Project root. Default: Vitest's `config.root`, else `process.cwd()`. */
  root?: string;
};

/** The reporter, typed structurally (only the hooks it implements). */
export type GrimoireReporter = {
  onInit?(context: unknown): void;
  onTestRunEnd?(...args: unknown[]): void | Promise<void>;
};

/** The part of Vitest's `TestCase` the reporter reads. */
type ReportedCase = {
  name: string;
  fullName: string;
  location?: { line: number } | undefined;
  result(): { state: string };
  diagnostic?(): { duration?: number } | undefined;
};

/** The part of Vitest's `TestModule` the reporter reads. */
type ReportedModule = {
  moduleId: string;
  state?(): string;
  children: { allTests(): Iterable<ReportedCase> };
};

type VitestContext = { config?: { root?: string; includeTaskLocation?: boolean } };

const OUTCOMES: Record<string, TestOutcome | undefined> = {
  passed: "pass",
  failed: "fail",
  skipped: "skip",
};

/** Create the reporter. */
export function grimoireReporter(options: GrimoireReporterOptions = {}): GrimoireReporter {
  let configRoot: string | undefined;
  let warned = false;

  const warn = (error: unknown): void => {
    if (warned) return;

    warned = true;
    console.warn(
      `[grimoire] Could not record test results: ${error instanceof Error ? error.message : String(error)}`,
    );
  };

  return {
    onInit(context) {
      const config = (context as VitestContext | undefined)?.config;

      configRoot = config?.root;

      // Test locations are how a test is matched to its `@proves` line.
      if (config) config.includeTaskLocation = true;
    },

    async onTestRunEnd(...args) {
      try {
        const modules = (Array.isArray(args[0]) ? args[0] : []) as ReportedModule[];
        const root = options.root ?? configRoot ?? process.cwd();
        const previous = await readTestResults(root);
        const now = new Date();
        const run: ProofResult[] = [];
        const ranFiles: string[] = [];

        for (const module of modules) {
          const done = await recordModule(root, module, previous, now);

          if (!done) continue;

          ranFiles.push(done.file);
          run.push(...done.results);
        }

        if (ranFiles.length === 0) return;

        await writeTestResults(root, mergeTestResults(previous, run, ranFiles, now));
      } catch (error) {
        warn(error);
      }
    },
  };
}

type ModuleRecord = { file: string; results: ProofResult[] };

/** Results of one test file, or `null` when the file did not finish (it must not erase old results). */
async function recordModule(
  root: string,
  module: ReportedModule,
  previous: TestResultsStore | null,
  now: Date,
): Promise<ModuleRecord | null> {
  if (module.state && module.state() === "pending") return null;

  const absolute = path.resolve(root, module.moduleId);
  const relative = toPosixPath(path.relative(root, absolute));

  if (relative.startsWith("..")) return null;

  let buffer: Buffer;

  try {
    buffer = await readFile(absolute);
  } catch {
    return null;
  }

  const hash = hashTestFile(buffer);
  const { proofs } = scanProofsInText(buffer.toString("utf8"), relative);
  const results: ProofResult[] = [];

  if (proofs.length === 0) return { file: relative, results };

  const cases = [...module.children.allTests()];

  for (const proof of proofs) {
    const matched = cases.filter((test) => matches(proof, test));
    const outcomes = matched.map((test) => ({ test, outcome: OUTCOMES[test.result().state] }));

    // A test still pending means the run was cut short: say nothing about this file.
    if (outcomes.some((item) => item.outcome === undefined)) return null;
    if (outcomes.length === 0 || !proof.test) continue;

    const outcome = combine(outcomes.map((item) => item.outcome as TestOutcome));
    const first = outcomes[0]?.test;

    if (!first) continue;

    const old = previous?.results.find(
      (item) =>
        item.testFile === relative &&
        item.feature === proof.feature &&
        item.flow === proof.flow &&
        item.criterion === proof.criterion &&
        item.testFileHash === hash,
    );

    // A skipped test (a `-t` filter, `.skip`) keeps the last real result of the same file content.
    if (outcome === "skip" && old) {
      results.push(old);

      continue;
    }

    results.push({
      feature: proof.feature,
      flow: proof.flow,
      criterion: proof.criterion,
      testFile: relative,
      testName: first.fullName,
      line: proof.test.line,
      outcome,
      durationMs: totalDuration(outcomes.map((item) => item.test)),
      ranAt: now.toISOString(),
      testFileHash: hash,
    });
  }

  return { file: relative, results };
}

function matches(proof: ProofLine, test: ReportedCase): boolean {
  if (!proof.test) return false;
  if (test.location) return test.location.line === proof.test.line;

  return proof.test.name !== null && proof.test.name === test.name;
}

/** One proving test can run several times (`it.each`): fail beats pass, pass beats skip. */
function combine(outcomes: TestOutcome[]): TestOutcome {
  if (outcomes.includes("fail")) return "fail";
  if (outcomes.includes("pass")) return "pass";

  return "skip";
}

function totalDuration(tests: ReportedCase[]): number | null {
  let total = 0;
  let known = false;

  for (const test of tests) {
    const duration = test.diagnostic?.()?.duration;

    if (typeof duration === "number") {
      total += duration;
      known = true;
    }
  }

  return known ? Math.round(total) : null;
}

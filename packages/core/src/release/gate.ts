import path from "node:path";
import { appendLog, readManifest, releaseDir, writeManifest, type ReleaseContext } from "./store";
import type { GateCheckResult, ReleaseManifest } from "./types";

const DEFAULT_CHECK_TIMEOUT_MS = 1_800_000;

/**
 * Run the configured checks, in order, inside the candidate's frozen source.
 *
 * The gate stops at the first failing check: later checks do not run and are
 * not recorded, so the manifest never claims a result that did not happen.
 * Results are written to the manifest either way. A passing gate moves the
 * candidate to `gated`; a failing one returns it to `candidate`. Either way
 * an earlier staging is discarded from the manifest.
 *
 * @example
 * const manifest = await runGate(context, "1.4.0-a1b2c3d");
 * if (!manifest.gate?.passed) process.exitCode = 1;
 */
export async function runGate(context: ReleaseContext, id: string): Promise<ReleaseManifest> {
  const manifest = await readManifest(context, id);

  if (manifest.status === "active" || manifest.status === "superseded") {
    throw new Error(`Release "${id}" is ${manifest.status}; only a new candidate can be gated.`);
  }

  const cwd = path.join(releaseDir(context, id), "source");
  const results: GateCheckResult[] = [];
  let passed = true;

  for (const check of context.config.checks) {
    const started = Date.now();
    const result = await context.runner(check.command, {
      cwd,
      timeoutMs: check.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
    });
    const ok = result.code === 0 && !result.timedOut;

    results.push({
      name: check.name,
      command: check.command,
      status: ok ? "passed" : "failed",
      exitCode: result.code,
      durationMs: Date.now() - started,
      ...(ok ? {} : { output: result.timedOut ? `${result.output}\n(timed out)` : result.output }),
    });

    if (!ok) {
      passed = false;
      break;
    }
  }

  const updated: ReleaseManifest = {
    ...manifest,
    status: passed ? "gated" : "candidate",
    gate: { passed, ranAt: context.now().toISOString(), results },
  };

  // A new gate run invalidates anything staged from an earlier one, so the
  // candidate has to be staged again.
  delete updated.staged;

  await writeManifest(context, updated);
  await appendLog(context, {
    event: "gate",
    release: id,
    ok: passed,
    detail: passed
      ? `${results.length} check(s) passed`
      : `failed at ${results[results.length - 1]?.name}`,
  });

  return updated;
}

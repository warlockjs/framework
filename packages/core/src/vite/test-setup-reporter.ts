import { writeFileSync } from "node:fs";
import { buildBootProfile, formatBootProfile } from "../tests/boot-profile";
import type { ProfiledFile } from "../tests/boot-profile";
import { recommendWorkerLifetime } from "../tests/setup-recommendation";
import { readTestServerBootProfile } from "../tests/test-runtime-scope";

export type TestSetupReporterOptions = {
  /**
   * Write the run's profile as JSON to this path. Defaults to the
   * `WARLOCK_TEST_PROFILE_JSON` environment variable; no file is written when
   * neither is set.
   */
  json?: string;
  /** How many of the slowest files to list. Defaults to 5. */
  slowest?: number;
};

const FILE_LABEL = /^\[warlock:test\] file=("(?:[^"\\]|\\.)*")/;

/** Vitest reporter shape, with no runtime dependency on Vitest in the config helper. */
export class TestSetupReporter {
  private files = 0;
  private bootstraps = 0;
  private workers = new Set<string>();
  private totals: Record<string, number> = {};
  private shutdowns = new Map<string, number>();
  private profiled: ProfiledFile[] = [];

  public constructor(private readonly options: TestSetupReporterOptions = {}) {}

  public onTestRunStart(): void {
    this.files = 0;
    this.bootstraps = 0;
    this.workers.clear();
    this.totals = {};
    this.shutdowns.clear();
    this.profiled = [];
  }

  public onUserConsoleLog(log: { content: string }): void {
    for (const line of log.content.split("\n")) {
      const file = line.startsWith("[warlock:test] file=");
      const summary = line.startsWith("[warlock:test] summary ");
      if (!file && !summary) continue;
      const marker = line.lastIndexOf("pid=");
      if (marker === -1) continue;
      const [pid, ...parts] = line
        .slice(marker + 4)
        .trim()
        .split(/\s+/);
      if (!pid || !/^\d+$/.test(pid)) continue;
      const steps: Record<string, number> = {};
      for (const part of parts) {
        const match = /^([a-zA-Z][\w.-]*)=(\d+(?:\.\d+)?)ms$/.exec(part);
        if (match?.[1] && match[2]) steps[match[1]] = Number(match[2]);
      }
      if (summary) {
        if (steps.shutdown !== undefined) this.shutdowns.set(pid, steps.shutdown);
        continue;
      }
      this.workers.add(pid);
      this.files += 1;
      if (steps.bootstrap !== undefined) this.bootstraps += 1;
      for (const [step, ms] of Object.entries(steps))
        this.totals[step] = (this.totals[step] ?? 0) + ms;
      this.profiled.push({ file: readFileLabel(line), pid, steps });
    }
  }

  public onTestRunEnd(): void {
    if (!this.files) return;
    const shutdown = [...this.shutdowns.values()].reduce((sum, ms) => sum + ms, 0);
    const steps = Object.entries({ ...this.totals, shutdown })
      .map(([step, ms]) => `${step}=${ms.toFixed(2)}ms`)
      .join(" ");
    const profile = buildBootProfile(this.profiled, { slowest: this.options.slowest });
    const server = readTestServerBootProfile();
    // One call, so a run prints its summary as a single block.
    console.info(
      [
        `[warlock:test] run summary files=${this.files} workers=${this.workers.size} bootstraps=${this.bootstraps} ${steps}`,
        ...formatBootProfile(profile, server),
      ].join("\n"),
    );
    this.writeJson(profile, server, shutdown);
    const { body = 0, ...setup } = { ...this.totals, shutdown };
    const advice = recommendWorkerLifetime({
      files: this.files,
      bootstraps: this.bootstraps,
      setupMs: Object.values(setup).reduce((sum, ms) => sum + ms, 0),
      bodyMs: body,
    });
    if (advice) console.info(advice);
  }

  private writeJson(
    profile: ReturnType<typeof buildBootProfile>,
    server: ReturnType<typeof readTestServerBootProfile>,
    shutdownMs: number,
  ): void {
    const path = this.options.json ?? process.env.WARLOCK_TEST_PROFILE_JSON;
    if (!path) return;
    const document = {
      files: this.files,
      workers: this.workers.size,
      bootstraps: this.bootstraps,
      shutdownMs,
      totals: this.totals,
      phases: profile.phases,
      connectors: profile.connectors,
      testMs: profile.bodyMs,
      server: server?.steps,
      slowestFiles: profile.slowestFiles,
      perFile: this.profiled,
    };
    try {
      writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
    } catch (error) {
      console.warn(`[warlock:test] could not write the profile to ${path}:`, error);
    }
  }
}

function readFileLabel(line: string): string {
  const label = FILE_LABEL.exec(line)?.[1];
  if (!label) return "unknown";
  try {
    return String(JSON.parse(label));
  } catch {
    return label;
  }
}

/**
 * Dispatch `release.yml` and follow the run to its end, from a terminal or an
 * agent, without the `gh` CLI.
 *
 *   node --import tsx scripts/dispatch-release.ts --version 5.31.0            # gate only
 *   node --import tsx scripts/dispatch-release.ts --version 5.31.0 --publish  # gate + publish
 *   node --import tsx scripts/dispatch-release.ts --watch <runId>             # follow an existing run
 *
 * The GitHub token is the first non-empty line of the file named by
 * `WARLOCK_RELEASE_TOKEN_FILE` (or the `GH_TOKEN` variable); later lines may
 * hold other tokens. It needs `Actions: Read and write` on
 * `warlockjs/framework`; see "Dispatching a release from automation" in
 * tools/release/README.md. The token is never printed.
 *
 * On failure it prints each failed job with its failed steps and annotations,
 * and saves the job logs next to the run's id under `release-logs/` so the
 * cause can be read without a browser. Exit code: 0 when the run succeeded,
 * 1 when it failed, 2 when it could not be dispatched or followed.
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY = "warlockjs/framework";
const WORKFLOW = "release.yml";
const API = `https://api.github.com/repos/${REPOSITORY}`;
const POLL_MS = 30_000;
const FIND_RUN_TIMEOUT_MS = 120_000;

export type RunSummary = {
  id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  event: string;
  head_sha: string;
};

export type JobSummary = {
  id: number;
  name: string;
  conclusion: string | null;
  steps?: Array<{ name: string; conclusion: string | null }>;
};

export type Annotation = {
  path?: string;
  start_line?: number;
  annotation_level?: string;
  message?: string;
};

export type DispatchArguments =
  | { type: "dispatch"; version: string; publish: boolean; ref: string }
  | { type: "watch"; runId: number };

/** Parse the command line; throws with a usage message on bad input. */
export function parseArguments(argv: string[]): DispatchArguments {
  const usage =
    "usage: dispatch-release.ts --version <x.y.z> [--publish] [--ref main] | --watch <runId>";
  const watchIndex = argv.indexOf("--watch");

  if (watchIndex !== -1) {
    const runId = Number(argv[watchIndex + 1]);

    if (!Number.isInteger(runId) || runId <= 0) {
      throw new Error(usage);
    }

    return { type: "watch", runId };
  }

  const versionIndex = argv.indexOf("--version");
  const version = versionIndex === -1 ? undefined : argv[versionIndex + 1];

  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(usage);
  }

  const refIndex = argv.indexOf("--ref");
  const ref = refIndex === -1 ? "main" : (argv[refIndex + 1] ?? "main");

  return { type: "dispatch", version, publish: argv.includes("--publish"), ref };
}

/**
 * The run a dispatch created: the newest `workflow_dispatch` run created at or
 * after the dispatch time (GitHub's clock may lag a little, so allow 60 s).
 */
export function pickDispatchedRun(runs: RunSummary[], dispatchedAt: Date): RunSummary | undefined {
  const earliest = dispatchedAt.getTime() - 60_000;

  return runs
    .filter((run) => run.event === "workflow_dispatch")
    .filter((run) => new Date(run.created_at).getTime() >= earliest)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

/** Failed jobs with the names of their failed steps. */
export function failedJobs(jobs: JobSummary[]): Array<{ job: JobSummary; failedSteps: string[] }> {
  return jobs
    .filter((job) => job.conclusion !== null && !["success", "skipped"].includes(job.conclusion))
    .map((job) => ({
      job,
      failedSteps: (job.steps ?? [])
        .filter((step) => step.conclusion === "failure")
        .map((step) => step.name),
    }));
}

function readToken(): string {
  const file = process.env.WARLOCK_RELEASE_TOKEN_FILE;
  const token = file
    ? readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line !== "")
    : process.env.GH_TOKEN?.trim();

  if (!token) {
    throw new Error("Set WARLOCK_RELEASE_TOKEN_FILE (a chmod 600 file) or GH_TOKEN.");
  }

  return token;
}

async function github(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url.startsWith("http") ? url : `${API}${url}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });

  if (!response.ok && response.status !== 204) {
    const body = await response.text();
    throw new Error(`GitHub ${response.status} for ${url}: ${body.slice(0, 300)}`);
  }

  return response;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function dispatch(token: string, version: string, publish: boolean, ref: string) {
  const dispatchedAt = new Date();

  await github(token, `/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref, inputs: { version, publish: String(publish) } }),
  });
  console.log(`Dispatched ${WORKFLOW} on ${ref}: version=${version} publish=${publish}`);

  const deadline = Date.now() + FIND_RUN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(5_000);
    const response = await github(
      token,
      `/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=10`,
    );
    const { workflow_runs: runs } = (await response.json()) as { workflow_runs: RunSummary[] };
    const run = pickDispatchedRun(runs, dispatchedAt);

    if (run) {
      return run.id;
    }
  }

  throw new Error("The dispatch was accepted but no run appeared within two minutes.");
}

async function report(token: string, run: RunSummary): Promise<void> {
  const jobsResponse = await github(token, `/actions/runs/${run.id}/jobs?per_page=100`);
  const { jobs } = (await jobsResponse.json()) as { jobs: JobSummary[] };
  const logDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "release-logs");

  for (const { job, failedSteps } of failedJobs(jobs)) {
    console.log(
      `\nFAILED job "${job.name}" (${job.id}); failed steps: ${failedSteps.join(", ") || "-"}`,
    );

    const annotationsResponse = await github(token, `/check-runs/${job.id}/annotations`);
    const annotations = (await annotationsResponse.json()) as Annotation[];

    for (const annotation of annotations.filter((entry) => entry.annotation_level === "failure")) {
      console.log(
        `  ${annotation.path ?? ""}:${annotation.start_line ?? ""} ${(annotation.message ?? "").slice(0, 800)}`,
      );
    }

    const logResponse = await github(token, `/actions/jobs/${job.id}/logs`);
    await mkdir(logDir, { recursive: true });
    const logFile = path.join(logDir, `run-${run.id}-job-${job.id}.log`);
    await writeFile(logFile, await logResponse.text());
    console.log(`  full log: ${logFile}`);
  }
}

async function watch(token: string, runId: number): Promise<number> {
  for (;;) {
    const response = await github(token, `/actions/runs/${runId}`);
    const run = (await response.json()) as RunSummary;

    if (run.status === "completed") {
      console.log(`Run ${run.id} finished: ${run.conclusion} (${run.html_url})`);

      if (run.conclusion === "success") {
        return 0;
      }

      await report(token, run);

      return 1;
    }

    console.log(`${new Date().toISOString()} run ${run.id}: ${run.status}`);
    await sleep(POLL_MS);
  }
}

async function main(): Promise<number> {
  const options = parseArguments(process.argv.slice(2));
  const token = readToken();
  const runId =
    options.type === "watch"
      ? options.runId
      : await dispatch(token, options.version, options.publish, options.ref);

  console.log(`Following run ${runId}: https://github.com/${REPOSITORY}/actions/runs/${runId}`);

  return watch(token, runId);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(2);
    },
  );
}

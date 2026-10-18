import assert from "node:assert/strict";
import { test } from "node:test";

import {
  failedJobs,
  parseArguments,
  pickDispatchedRun,
  type RunSummary,
} from "../dispatch-release.ts";

const run = (id: number, createdAt: string, event = "workflow_dispatch"): RunSummary => ({
  id,
  status: "queued",
  conclusion: null,
  html_url: `https://github.com/warlockjs/framework/actions/runs/${id}`,
  created_at: createdAt,
  event,
  head_sha: "abc",
});

test("parseArguments reads a gate dispatch, a publish dispatch and a watch", () => {
  assert.deepEqual(parseArguments(["--version", "5.31.0"]), {
    type: "dispatch",
    version: "5.31.0",
    publish: false,
    ref: "main",
  });
  assert.deepEqual(parseArguments(["--version", "5.31.0", "--publish", "--ref", "main"]), {
    type: "dispatch",
    version: "5.31.0",
    publish: true,
    ref: "main",
  });
  assert.deepEqual(parseArguments(["--watch", "123"]), { type: "watch", runId: 123 });
});

test("parseArguments refuses a missing or inexact version and a bad run id", () => {
  assert.throws(() => parseArguments([]), /usage/);
  assert.throws(() => parseArguments(["--version", "5.31"]), /usage/);
  assert.throws(() => parseArguments(["--version", "v5.31.0"]), /usage/);
  assert.throws(() => parseArguments(["--watch", "abc"]), /usage/);
});

test("pickDispatchedRun takes the newest dispatch created after the dispatch time", () => {
  const dispatchedAt = new Date("2026-10-18T10:00:00Z");
  const runs = [
    run(1, "2026-10-18T09:00:00Z"),
    run(2, "2026-10-18T10:00:05Z"),
    run(3, "2026-10-18T10:00:09Z", "push"),
    run(4, "2026-10-18T09:59:30Z"),
  ];

  assert.equal(pickDispatchedRun(runs, dispatchedAt)?.id, 2);
  assert.equal(pickDispatchedRun([run(1, "2026-10-18T09:00:00Z")], dispatchedAt), undefined);
});

test("failedJobs lists failed jobs with their failed steps and ignores the rest", () => {
  const result = failedJobs([
    { id: 1, name: "gate", conclusion: "success", steps: [] },
    { id: 2, name: "skipped", conclusion: "skipped" },
    {
      id: 3,
      name: "release",
      conclusion: "failure",
      steps: [
        { name: "Install", conclusion: "success" },
        { name: "Publish to npm", conclusion: "failure" },
      ],
    },
    { id: 4, name: "running", conclusion: null },
  ]);

  assert.deepEqual(
    result.map((entry) => [entry.job.id, entry.failedSteps]),
    [[3, ["Publish to npm"]]],
  );
});

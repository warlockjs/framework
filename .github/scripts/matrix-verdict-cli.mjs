// CLI wrapper around computeVerdict — reads the plan + downloaded row
// results + upstream job outcomes from the environment, writes
// /tmp/verdict.json and the step summary, and fails the step (non-zero
// exit) unless every planned row produced exactly one successful result.
//
// Required env:
//   EXPECTED_ROWS         JSON array of { row, os } — needs.artifacts.outputs.expected
//   RESULTS_DIR           directory of downloaded result-*.json files
//   SHA, VERSION, AUTHORISED_BY, AUTHORISATION
//   NEEDS_ARTIFACTS_RESULT, NEEDS_MATRIX_RESULT, NEEDS_WINDOWS_CANARY_RESULT
//   GITHUB_STEP_SUMMARY   path to append the markdown table to

import fs from "node:fs";
import path from "node:path";
import { computeVerdict } from "./matrix-verdict.mjs";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var ${name}`);
  }
  return value;
}

function readResults(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

const expected = JSON.parse(requireEnv("EXPECTED_ROWS"));
const results = readResults(process.env.RESULTS_DIR ?? "/tmp/results");
const needsResults = [
  { name: "artifacts", result: requireEnv("NEEDS_ARTIFACTS_RESULT") },
  { name: "matrix", result: requireEnv("NEEDS_MATRIX_RESULT") },
  { name: "windows-canary", result: requireEnv("NEEDS_WINDOWS_CANARY_RESULT") },
];

const { overall, table, problems } = computeVerdict({ expected, results, needsResults });

const verdict = {
  sha: requireEnv("SHA"),
  version: requireEnv("VERSION"),
  authorisedBy: requireEnv("AUTHORISED_BY"),
  authorisation: requireEnv("AUTHORISATION"),
  rows: table,
  problems,
  overall,
};

fs.writeFileSync("/tmp/verdict.json", JSON.stringify(verdict, null, 2));

const lines = [
  "# generator-matrix verdict",
  "",
  "sha: `" + verdict.sha + "`",
  "version: `" + verdict.version + "`",
  "authorised by: " + verdict.authorisedBy + " — " + verdict.authorisation,
  "",
  "| row | os | status |",
  "| --- | --- | --- |",
  ...table.map((r) => "| " + r.row + " | " + r.os + " | " + r.status + " |"),
];
if (problems.length > 0) {
  lines.push("", "**problems:**", ...problems.map((p) => "- " + p));
}
lines.push("", "**overall: " + overall + "**");

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n", { flag: "a" });
} else {
  console.log(lines.join("\n"));
}

if (overall !== "success") {
  console.error(problems.join("\n"));
  process.exitCode = 1;
}

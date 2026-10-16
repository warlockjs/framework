import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerdict } from "./matrix-verdict.mjs";

const okNeeds = [
  { name: "artifacts", result: "success" },
  { name: "matrix", result: "success" },
  { name: "windows-canary", result: "success" },
];

test("all expected rows present and green -> success", () => {
  const expected = [
    { row: "baseline", os: "ubuntu-latest" },
    { row: "web", os: "ubuntu-latest" },
    { row: "baseline", os: "windows-latest" },
  ];
  const results = expected.map((e) => ({ ...e, conclusion: "success" }));
  const { overall, problems } = computeVerdict({ expected, results, needsResults: okNeeds });
  assert.equal(overall, "success");
  assert.deepEqual(problems, []);
});

test("one missing row -> failure naming it", () => {
  const expected = [
    { row: "baseline", os: "ubuntu-latest" },
    { row: "web", os: "ubuntu-latest" },
  ];
  const results = [{ row: "baseline", os: "ubuntu-latest", conclusion: "success" }];
  const { overall, problems } = computeVerdict({ expected, results, needsResults: okNeeds });
  assert.equal(overall, "failure");
  assert.ok(problems.some((p) => p.includes('missing result for row "web"')));
});

test("duplicate result for a row -> failure", () => {
  const expected = [{ row: "baseline", os: "ubuntu-latest" }];
  const results = [
    { row: "baseline", os: "ubuntu-latest", conclusion: "success" },
    { row: "baseline", os: "ubuntu-latest", conclusion: "success" },
  ];
  const { overall, problems } = computeVerdict({ expected, results, needsResults: okNeeds });
  assert.equal(overall, "failure");
  assert.ok(problems.some((p) => p.includes('duplicate result for row "baseline"')));
});

test("one row failed -> failure", () => {
  const expected = [
    { row: "baseline", os: "ubuntu-latest" },
    { row: "web", os: "ubuntu-latest" },
  ];
  const results = [
    { row: "baseline", os: "ubuntu-latest", conclusion: "success" },
    { row: "web", os: "ubuntu-latest", conclusion: "failure" },
  ];
  const { overall, problems } = computeVerdict({ expected, results, needsResults: okNeeds });
  assert.equal(overall, "failure");
  assert.ok(problems.some((p) => p.includes('row "web" (ubuntu-latest) did not succeed: failure')));
});

test("unexpected result not in the plan -> failure", () => {
  const expected = [{ row: "baseline", os: "ubuntu-latest" }];
  const results = [
    { row: "baseline", os: "ubuntu-latest", conclusion: "success" },
    { row: "cache", os: "ubuntu-latest", conclusion: "success" },
  ];
  const { overall, problems } = computeVerdict({ expected, results, needsResults: okNeeds });
  assert.equal(overall, "failure");
  assert.ok(problems.some((p) => p.includes('unexpected result for row "cache"')));
});

test("a dependency job reporting failure fails the verdict even with green files", () => {
  const expected = [{ row: "baseline", os: "ubuntu-latest" }];
  const results = [{ row: "baseline", os: "ubuntu-latest", conclusion: "success" }];
  const needsResults = [
    { name: "artifacts", result: "success" },
    { name: "matrix", result: "failure" },
    { name: "windows-canary", result: "success" },
  ];
  const { overall, problems } = computeVerdict({ expected, results, needsResults });
  assert.equal(overall, "failure");
  assert.ok(problems.some((p) => p.includes('dependency job "matrix" reported failure')));
});

test("no expected rows at all -> failure, never a vacuous success", () => {
  const { overall, problems } = computeVerdict({
    expected: [],
    results: [],
    needsResults: okNeeds,
  });
  assert.equal(overall, "failure");
  assert.ok(problems.some((p) => p.includes("no expected rows were planned")));
});

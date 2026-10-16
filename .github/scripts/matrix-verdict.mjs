// Pure computation for the generator-matrix verdict. No filesystem, no
// process.env — kept testable with plain `node --test` (see
// matrix-verdict.test.mjs). The CLI wrapper (matrix-verdict-cli.mjs) does
// all I/O and calls this.

function rowKey(row, os) {
  return `${row}::${os}`;
}

// expected: [{ row, os }]
// results: [{ row, os, conclusion, ... }] (one file per row-result artifact)
// needsResults: [{ name, result }] (the `needs.<job>.result` of every job the
// verdict depends on, e.g. artifacts/matrix/windows-canary)
export function computeVerdict({ expected, results, needsResults }) {
  const resultsByKey = new Map();
  for (const result of results) {
    const key = rowKey(result.row, result.os);
    const list = resultsByKey.get(key) ?? [];
    list.push(result);
    resultsByKey.set(key, list);
  }

  const expectedKeys = new Set(expected.map((e) => rowKey(e.row, e.os)));

  const missing = [];
  const duplicates = [];
  const table = [];

  for (const { row, os } of expected) {
    const key = rowKey(row, os);
    const matches = resultsByKey.get(key) ?? [];
    if (matches.length === 0) {
      missing.push({ row, os });
      table.push({ row, os, status: "MISSING" });
    } else if (matches.length > 1) {
      duplicates.push({ row, os, count: matches.length });
      table.push({ row, os, status: `DUPLICATE (${matches.length})` });
    } else {
      table.push({ row, os, status: matches[0].conclusion });
    }
  }

  const unexpected = results.filter((result) => !expectedKeys.has(rowKey(result.row, result.os)));
  for (const result of unexpected) {
    table.push({ row: result.row, os: result.os, status: `UNEXPECTED (${result.conclusion})` });
  }

  const failedNeeds = needsResults.filter(
    (n) => n.result === "failure" || n.result === "cancelled",
  );

  const nonSuccessResults = results.filter(
    (r) => resultsByKey.get(rowKey(r.row, r.os))?.length === 1 && r.conclusion !== "success",
  );

  const problems = [];
  if (expected.length === 0) problems.push("no expected rows were planned");
  for (const m of missing) problems.push(`missing result for row "${m.row}" (${m.os})`);
  for (const d of duplicates) {
    problems.push(`duplicate result for row "${d.row}" (${d.os}): ${d.count} files`);
  }
  for (const u of unexpected) {
    problems.push(`unexpected result for row "${u.row}" (${u.os}), not in the plan`);
  }
  for (const r of nonSuccessResults) {
    problems.push(`row "${r.row}" (${r.os}) did not succeed: ${r.conclusion}`);
  }
  for (const n of failedNeeds) {
    problems.push(`dependency job "${n.name}" reported ${n.result}`);
  }

  const overall = problems.length === 0 ? "success" : "failure";

  return { overall, table, problems, missing, duplicates, unexpected };
}

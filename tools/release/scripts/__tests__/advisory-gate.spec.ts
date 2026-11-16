import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectDeclarations,
  findExcludedPatchedRanges,
  type Advisory,
  type AdvisoryGateDependencies,
} from "../advisory-gate.ts";

const advisory: Advisory = {
  id: 1,
  url: "https://github.com/advisories/GHSA-test",
  title: "Prototype pollution",
  severity: "high",
  vulnerable_versions: "<1.2.0",
};

function dependencies(
  versions: string[],
  advisories: Record<string, Advisory[]>,
): AdvisoryGateDependencies {
  return {
    listVersions: async () => versions,
    fetchAdvisories: async () => advisories,
  };
}

describe("advisory gate", () => {
  it("skips family packages, workspace links and non-registry ranges", () => {
    const declarations = collectDeclarations([
      {
        name: "@warlock.js/core",
        dependencies: { "@warlock.js/seal": "5.0.0", lodash: "^4.0.0", local: "workspace:*" },
        peerDependencies: { nodemailer: "^8.0.5 || ^10.1.4", fork: "github:a/b" },
      },
    ]);
    assert.deepEqual(
      declarations.map((entry) => `${entry.name}@${entry.range}`),
      ["lodash@^4.0.0", "nodemailer@^8.0.5 || ^10.1.4"],
    );
  });

  it("fails a range whose highest version is affected", async () => {
    const findings = await findExcludedPatchedRanges(
      [{ declaredBy: "pkg", name: "dep", range: "^1.0.0" }],
      dependencies(["1.0.0", "1.1.0", "1.2.0"], {
        dep: [{ ...advisory, vulnerable_versions: ">=1.0.0" }],
      }),
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.version, "1.2.0");
  });

  it("passes a range that still admits a patched version", async () => {
    const findings = await findExcludedPatchedRanges(
      [{ declaredBy: "pkg", name: "dep", range: "^1.0.0" }],
      dependencies(["1.0.0", "1.2.0"], { dep: [advisory] }),
    );
    assert.deepEqual(findings, []);
  });

  it("does not fail on a waived advisory", async () => {
    const findings = await findExcludedPatchedRanges(
      [{ declaredBy: "pkg", name: "dep", range: "~1.1.0" }],
      dependencies(["1.1.0", "1.1.5"], { dep: [advisory] }),
      new Set([advisory.url]),
    );
    assert.deepEqual(findings, []);
  });
});

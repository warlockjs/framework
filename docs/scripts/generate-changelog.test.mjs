// @ts-check
// Red/green control for the SemVer 2.0.0 descending comparator used to order
// the unified changelog. Run with `node --test scripts/generate-changelog.test.mjs`
// (or `pnpm test:changelog`) from docs/. Importing this module — or
// generate-changelog.mjs itself — must never trigger the generator; see the
// direct-execution guard at the bottom of generate-changelog.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { cmpVersionDesc } from "./generate-changelog.mjs";

function assertDesc(higher, lower, msg) {
  assert.ok(cmpVersionDesc(higher, lower) < 0, `${msg}: expected ${higher} before ${lower}`);
  assert.ok(cmpVersionDesc(lower, higher) > 0, `${msg}: expected ${lower} after ${higher}`);
}

test("a release outranks its own prerelease", () => {
  assertDesc("1.0.0", "1.0.0-rc.1", "release vs rc");
});

test("prerelease numeric identifiers compare numerically, not lexically", () => {
  assertDesc("1.0.0-rc.10", "1.0.0-rc.2", "rc.10 vs rc.2");
});

test("numeric prerelease identifiers always sort below alphanumeric ones", () => {
  assertDesc("1.0.0-alpha", "1.0.0-1", "alpha vs numeric identifier");
});

test("a shorter equal-prefix prerelease sorts below the longer one", () => {
  assertDesc("1.0.0-alpha.1", "1.0.0-alpha", "alpha.1 vs alpha");
});

test("core version precedence (major, then minor, then patch)", () => {
  assertDesc("2.0.0", "1.9.9", "major");
  assertDesc("1.2.0", "1.1.9", "minor");
  assertDesc("1.1.2", "1.1.1", "patch");
  assertDesc(
    "90071992547409930.0.0",
    "90071992547409929.99999999999999999.99999999999999999",
    "arbitrarily large numeric identifiers",
  );
});

test("build metadata is ignored for precedence — a tie stays a tie", () => {
  assert.equal(cmpVersionDesc("1.0.0+build.1", "1.0.0+build.2") === 0, true);
});

test("malformed versions are rejected with a clear error, never silently tied", () => {
  assert.throws(() => cmpVersionDesc("1.0", "1.0.0"), /Invalid SemVer version/);
  assert.throws(() => cmpVersionDesc("1.0.0", "v1.0.0"), /Invalid SemVer version/);
  assert.throws(() => cmpVersionDesc("1.00.0", "1.0.0"), /Invalid SemVer version/);
  assert.throws(() => cmpVersionDesc("1.0.0-01", "1.0.0"), /Invalid SemVer version/);
  assert.throws(() => cmpVersionDesc(" 1.0.0", "1.0.0"), /Invalid SemVer version/);
});

test("sorts a mixed version list into descending SemVer order", () => {
  const input = [
    "1.0.0-rc.2",
    "1.0.0",
    "2.0.0",
    "1.0.0-alpha",
    "1.0.0-rc.10",
    "1.2.3",
    "1.0.0-alpha.1",
  ];
  const expected = [
    "2.0.0",
    "1.2.3",
    "1.0.0",
    "1.0.0-rc.10",
    "1.0.0-rc.2",
    "1.0.0-alpha.1",
    "1.0.0-alpha",
  ];
  assert.deepEqual([...input].sort(cmpVersionDesc), expected);
});

import { describe, expect, it } from "vitest";
import { entry, feature, flow, snapshot } from "../../../tests/check/snapshot-builder";
import type { GrimoireFinding, WrittenFeature } from "../../contracts";
import { checkChangeWords, checkFlowVersions, checkReadmeDates } from "./versions";

function summary(findings: GrimoireFinding[]): string[] {
  return findings.map(
    (finding) =>
      `${finding.code} ${finding.severity} ${finding.at?.file}:${finding.at?.line} ${finding.message}`,
  );
}

function run(rule: typeof checkReadmeDates, features: WrittenFeature[]): string[] {
  const target = snapshot();

  target.written.features = features;

  return summary(rule(target));
}

describe("checkReadmeDates", () => {
  const entries = [
    entry("2.1", "fixed"),
    entry("2.0", "added", { release: "1.1.0", date: "2026-10-20" }),
    entry("1.0", "added", { release: "1.0.0", date: "2026-10-01" }),
  ];

  it("reports nothing when the README is as new as the changelog", () => {
    expect(
      run(checkReadmeDates, [feature("shop", { version: "2.1", updated: "2026-10-20", entries })]),
    ).toEqual([]);
  });

  it("GR6004: README updated before the newest dated changelog section", () => {
    expect(
      run(checkReadmeDates, [feature("shop", { version: "2.1", updated: "2026-10-19", entries })]),
    ).toEqual([
      "GR6004 error grimoire/features/shop/README.md:6 README of shop was updated 2026-10-19, before its changelog entries of 2026-10-20",
    ]);
  });

  it("GR6005: README version differs from the newest entry", () => {
    expect(
      run(checkReadmeDates, [feature("shop", { version: "2.0", updated: "2026-11-01", entries })]),
    ).toEqual([
      "GR6005 error grimoire/features/shop/README.md:5 README of shop says version 2.0, the newest changelog entry is 2.1",
    ]);
    expect(
      run(checkReadmeDates, [
        feature("shop", {
          version: "1.10",
          entries: [entry("1.9", "fixed"), entry("1.10", "fixed")],
        }),
      ]),
    ).toEqual([]);
  });
});

describe("checkChangeWords", () => {
  it("reports nothing when added and removed take whole numbers and changed and fixed decimals", () => {
    const entries = [
      entry("3.0", "removed"),
      entry("2.2", "changed"),
      entry("2.1", "fixed"),
      entry("2.0", "added"),
    ];

    expect(run(checkChangeWords, [feature("shop", { entries })])).toEqual([]);
  });

  it("GR6006: a word on the wrong version step", () => {
    expect(
      run(checkChangeWords, [
        feature("shop", {
          entries: [
            entry("2.1", "added", { flow: "order", line: 4 }),
            entry("2.0", "fixed", { line: 5 }),
          ],
        }),
      ]),
    ).toEqual([
      "GR6006 warning grimoire/features/x/CHANGELOG.md:4 changelog entry 2.1 added uses a decimal version; added takes a whole-number one",
      "GR6006 warning grimoire/features/x/CHANGELOG.md:5 changelog entry 2.0 fixed uses a whole-number version; fixed takes a decimal one",
    ]);
  });
});

describe("checkFlowVersions", () => {
  it("reports nothing when flows are not newer than the feature and new versions have briefs", () => {
    expect(
      run(checkFlowVersions, [
        feature("shop", {
          version: "2.1",
          versions: [3],
          flows: [
            flow("shop", "order", { since: "2.1" }),
            flow("shop", "wishlist", { since: "2.0" }),
            flow("shop", "gift", { since: "2.0", status: "proposed" }),
          ],
        }),
      ]),
    ).toEqual([]);
  });

  it("GR6007: a flow since a version newer than the feature", () => {
    expect(
      run(checkFlowVersions, [
        feature("shop", {
          version: "2.1",
          versions: [3],
          flows: [flow("shop", "wishlist", { since: "3.0", status: "proposed" })],
        }),
      ]),
    ).toEqual([
      "GR6007 error grimoire/features/shop/flows/wishlist.md:3 shop/wishlist is since 3.0, newer than shop 2.1",
    ]);
  });

  it("GR6008: a proposed flow starting a whole-number version with no brief", () => {
    expect(
      run(checkFlowVersions, [
        feature("shop", {
          version: "3.0",
          flows: [flow("shop", "wishlist", { since: "4.0", status: "proposed" })],
        }),
      ]),
    ).toEqual([
      "GR6007 error grimoire/features/shop/flows/wishlist.md:3 shop/wishlist is since 4.0, newer than shop 3.0",
      "GR6008 warning grimoire/features/shop/flows/wishlist.md:3 shop/wishlist starts shop 4.0, which has no brief versions/v4.md",
    ]);
  });
});

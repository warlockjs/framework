import { describe, expect, it, vi } from "vitest";
import { feature, flow, snapshot } from "../../tests/check/snapshot-builder";
import { createFinding } from "../codes";
import type { GrimoireSnapshot } from "../contracts";
import { checkGrimoire, finishReport } from "./check-grimoire";
import { checkBookNotes } from "./rules/book-notes";

vi.mock("../apps", () => ({
  checkApps: () => [createFinding({ code: "GR5001", message: "from checkApps" })],
}));
vi.mock("../releases", () => ({
  checkReleases: () => [createFinding({ code: "GR6002", message: "from checkReleases" })],
}));
vi.mock("../tasks", () => ({
  checkTasks: () => [createFinding({ code: "GR7001", message: "from checkTasks" })],
}));
vi.mock("../test-results", () => ({
  checkTestResults: () => [createFinding({ code: "GR4006", message: "from checkTestResults" })],
}));

function proposedSnapshot(): GrimoireSnapshot {
  const target = snapshot();

  target.written.features = [
    feature("shop", {
      flows: [flow("shop", "order"), flow("shop", "wishlist", { status: "proposed" })],
    }),
    feature("gifts", { status: "proposed", flows: [flow("gifts", "send")] }),
  ];

  return target;
}

const at = (file: string, line: number) => ({ file, line, column: null });

describe("finishReport", () => {
  it("marks findings on proposed features and flows as expected, without changing the snapshot's findings", () => {
    const target = proposedSnapshot();
    const onWishlist = createFinding({
      code: "GR2001",
      message: "a",
      flow: "shop/wishlist",
      feature: "shop",
    });
    const onGifts = createFinding({ code: "GR2001", message: "b", feature: "gifts" });
    const onGiftsFlow = createFinding({ code: "GR4001", message: "c", flow: "gifts/send" });
    const onOrder = createFinding({
      code: "GR2001",
      message: "d",
      flow: "shop/order",
      feature: "shop",
    });

    target.structure = [onWishlist];

    const report = finishReport(target, [onWishlist, onGifts, onGiftsFlow, onOrder]);

    expect(report.findings.map((finding) => `${finding.message} ${finding.expected}`)).toEqual([
      "d false",
      "a true",
      "b true",
      "c true",
    ]);
    expect(onWishlist.expected).toBe(false);
    expect(report.counts).toEqual({ errors: 1, warnings: 0, expected: 3 });
    expect(report.ok).toBe(false);
  });

  it("is ok when every error is expected, and sorts unexpected errors, warnings, then expected ones by file and line", () => {
    const report = finishReport(proposedSnapshot(), [
      createFinding({ code: "GR4001", message: "w2", at: at("b.md", 3) }),
      createFinding({ code: "GR2001", message: "x", at: at("a.md", 9), flow: "shop/wishlist" }),
      createFinding({ code: "GR4001", message: "w1", at: at("b.md", 2) }),
      createFinding({ code: "GR8003", message: "note" }),
      createFinding({ code: "GR3001", message: "w0", at: at("a.md", 5) }),
    ]);

    expect(report.findings.map((finding) => finding.message)).toEqual([
      "note",
      "w0",
      "w1",
      "w2",
      "x",
    ]);
    expect(report).toMatchObject({
      schemaVersion: 1,
      root: "/project",
      ok: true,
      routes: "fresh",
      counts: { errors: 0, warnings: 4, expected: 1 },
    });
  });
});

describe("checkGrimoire", () => {
  it("runs the structure and proof findings, its own rules and every other module's rules", () => {
    const target = proposedSnapshot();

    target.structure = [createFinding({ code: "GR1003", message: "from the parser" })];
    target.proofFindings = [createFinding({ code: "GR4003", message: "from scanProofs" })];
    target.routes = "stale";
    target.written.features[0]?.flows[0]?.criteria.push({
      id: "AC-1",
      number: 1,
      app: null,
      text: "x",
      at: at("grimoire/features/shop/flows/order.md", 30),
    });

    const report = checkGrimoire(target);

    expect(report.findings.map((finding) => finding.code).sort()).toEqual(
      ["GR1003", "GR4001", "GR4003", "GR4006", "GR5001", "GR6002", "GR7001", "GR8003"].sort(),
    );
    expect(report.routes).toBe("stale");
  });
});

describe("checkBookNotes", () => {
  it("GR8003: route facts are stale; nothing when fresh, cached or missing", () => {
    const stale = snapshot({ routes: "stale" });

    expect(
      checkBookNotes(stale).map(
        (finding) => `${finding.code} ${finding.severity} ${finding.message}`,
      ),
    ).toEqual([
      "GR8003 warning route facts are stale; route steps were checked against the cached routes",
    ]);

    for (const routes of ["fresh", "cached", "missing"] as const)
      expect(checkBookNotes(snapshot({ routes }))).toEqual([]);
  });
});

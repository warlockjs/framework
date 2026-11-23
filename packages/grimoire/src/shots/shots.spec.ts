import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { feature, flow, proof, snapshot } from "../../tests/check/snapshot-builder";
import { checkDrift } from "../check/rules/drift";
import { checkShows } from "../check/rules/shows";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type { ApprovedBaseline, ShotCapture, ShowsLine } from "../contracts/shots";
import { approveItems, rejectItems, selectDrift } from "./approve";
import { computeDrift } from "./drift";
import { solidPng, encodePng } from "./png.test-support";
import { mergeCaptures, readBaseline, readCaptureIndex, writeCaptureIndex } from "./store";

const REF = "contact/send-message";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function write(root: string, file: string, bytes: Uint8Array): void {
  const target = path.join(root, "grimoire", "screenshots", ...file.split("/"));

  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

const WHITE = solidPng(20, 20);
const BLACK = solidPng(20, 20, [0, 0, 0, 255]);
/** One pixel in a hundred differs by a little: under the channel delta. */
const NEAR = encodePng(20, 20, (x, y) => (x === 0 && y === 0 ? [250, 250, 250, 255] : [255, 255, 255, 255]));

function capture(criterion: string, language: string, bytes: Uint8Array, outcome: "pass" | "fail" = "pass"): ShotCapture {
  return {
    ref: REF,
    criterion,
    language,
    file: outcome === "pass" ? `captured/${REF}/${criterion}.${language}.png` : null,
    sha256: outcome === "pass" ? sha(bytes) : null,
    outcome,
    error: outcome === "pass" ? null : "the button was not found",
    viewport: { name: "desktop", width: 1280, height: 800 },
    spec: "e2e/shows.e2e.ts",
    ranAt: "2026-11-23T10:00:00.000Z",
  };
}

function line(criterion: string): ShowsLine {
  return {
    feature: "contact",
    flow: "send-message",
    ref: REF,
    criterion,
    call: { line: 2 },
    at: { file: "e2e/shows.e2e.ts", line: 1, column: null },
  };
}

type Setup = { root: string; snap: GrimoireSnapshot };

/** A project with captures and a baseline, and the drift between them. */
async function setup(options: { rejected?: boolean } = {}): Promise<Setup> {
  const root = mkdtempSync(path.join(tmpdir(), "grimoire-shots-"));

  roots.push(root);

  write(root, `captured/${REF}/AC-1.en.png`, BLACK);
  write(root, `captured/${REF}/AC-1.ar.png`, WHITE);
  write(root, `captured/${REF}/AC-2.en.png`, NEAR);
  write(root, `approved/${REF}/AC-1.en.png`, WHITE);
  write(root, `approved/${REF}/AC-2.en.png`, WHITE);
  write(root, `approved/${REF}/AC-1.fr.png`, WHITE);

  const approved = (criterion: string, language: string) => ({
    ref: REF,
    criterion,
    language,
    file: `approved/${REF}/${criterion}.${language}.png`,
    sha256: sha(WHITE),
    approvedAt: "2026-11-01T00:00:00.000Z",
  });
  const baseline: ApprovedBaseline = {
    schemaVersion: 1,
    approvedAt: "2026-11-01T00:00:00.000Z",
    flows: [
      {
        ref: REF,
        criteria: [
          { id: "AC-1", text: "criterion AC-1" },
          { id: "AC-2", text: "old words" },
          { id: "AC-3", text: "criterion AC-3" },
        ],
        cases: ["invalid input", "duplicate"],
      },
      { ref: "shop/cart", criteria: [], cases: [] },
    ],
    proofs: [{ ref: REF, criterion: "AC-1", testFile: "src/a.test.ts", testName: "sends" }],
    shots: [approved("AC-1", "en"), approved("AC-2", "en"), approved("AC-1", "fr")],
    rejected: options.rejected
      ? [{ id: `shot-changed:${REF}:AC-1:en`, rejectedAt: "2026-11-02T00:00:00.000Z", note: "too dark" }]
      : [],
  };
  const contact = flow("contact", "send-message", { criteria: ["AC-1", "AC-2", "AC-4"] });

  contact.cases.push(
    { question: "invalid input", fixed: true, answer: "a", doesNotApply: false, criteria: [], at: contact.criteria[0]!.at },
    { question: "server error", fixed: true, answer: "b", doesNotApply: false, criteria: [], at: contact.criteria[0]!.at },
  );

  const snap = snapshot({
    root,
    proofs: [proof(REF, "AC-2")],
  });

  snap.written.features = [
    feature("contact", { flows: [contact] }),
    feature("shop", { flows: [flow("shop", "new")] }),
  ];

  const captures = {
    schemaVersion: 1 as const,
    updatedAt: "2026-11-23T10:00:00.000Z",
    captures: [
      capture("AC-1", "en", BLACK),
      capture("AC-1", "ar", WHITE),
      capture("AC-2", "en", NEAR),
      capture("AC-2", "ar", WHITE, "fail"),
    ],
  };
  const shows = [line("AC-1"), line("AC-2")];
  const drift = await computeDrift({
    root,
    written: snap.written,
    proofs: snap.proofs,
    shows,
    captures,
    baseline,
    languages: ["en", "ar"],
    optedOut: [],
  });

  snap.settings = { file: null, languages: ["en", "ar"], languagesFrom: "settings", screenshots: "changed", rules: null, protected: [] };
  snap.shots = { mode: "changed", shows, showsFindings: [], captures, baseline, drift, optedOut: [] };

  return { root, snap };
}

describe("drift", () => {
  it("finds every type of change against the baseline", async () => {
    const { snap } = await setup();
    const ids = (snap.shots?.drift ?? []).map((item) => item.id).sort();

    expect(ids).toEqual(
      [
        `shot-changed:${REF}:AC-1:en`,
        `shot-added:${REF}:AC-1:ar`,
        `shot-removed:${REF}:AC-1:fr`,
        `criterion-changed:${REF}:AC-2`,
        `criterion-removed:${REF}:AC-3`,
        `criterion-added:${REF}:AC-4`,
        `case-added:${REF}:server error`,
        `case-removed:${REF}:duplicate`,
        `proof-removed:${REF}:AC-1`,
        "flow-added:shop/new",
        "flow-removed:shop/cart",
      ].sort(),
    );
  });

  it("does not report a capture within the tolerance of its approved image", async () => {
    const { snap } = await setup();

    expect(snap.shots?.drift.some((item) => item.id.includes("AC-2:en"))).toBe(false);
  });

  it("marks a rejected item", async () => {
    const { snap } = await setup({ rejected: true });
    const item = snap.shots?.drift.find((entry) => entry.id === `shot-changed:${REF}:AC-1:en`);

    expect(item?.rejected?.note).toBe("too dark");
  });

  it("is empty with no baseline (the state loader never calls it)", async () => {
    const { snap } = await setup();

    expect(checkDrift({ ...snap, shots: { ...snap.shots!, baseline: null, drift: [] } })).toEqual([]);
  });
});

describe("check rules over shots", () => {
  it("lists one finding per drift item, rejected ones as errors", async () => {
    const { snap } = await setup({ rejected: true });
    const findings = checkDrift(snap);

    expect(findings.filter((finding) => finding.code === "GR4017")).toHaveLength(2);
    expect(findings.filter((finding) => finding.code === "GR4018")).toHaveLength(8);
    expect(findings.filter((finding) => finding.code === "GR4019")).toHaveLength(1);
  });

  it("lists a missing language (GR4015) and a failed scene (GR4016)", async () => {
    const { snap } = await setup();
    const shots = { ...snap.shots!, captures: { ...snap.shots!.captures!, captures: snap.shots!.captures!.captures.filter((c) => !(c.criterion === "AC-1" && c.language === "ar")) } };
    const codes = checkShows({ ...snap, shots }).map((finding) => `${finding.code}`);

    expect(codes.sort()).toEqual(["GR4015", "GR4016"]);
  });

  it("asks for nothing when the mode is off or the flow opted out", async () => {
    const { snap } = await setup();
    const empty = { ...snap.shots!, captures: null };

    expect(checkShows({ ...snap, shots: { ...empty, mode: "off" } })).toEqual([]);
    expect(checkShows({ ...snap, shots: { ...empty, optedOut: [REF] } })).toEqual([]);
    expect(checkShows({ ...snap, shots: empty })).toHaveLength(4);
  });
});

describe("approve and reject", () => {
  it("approves one flow's shot items of one language and keeps the rest", async () => {
    const { root, snap } = await setup();
    const items = selectDrift(snap, { targets: [REF], language: "ar" });

    expect(items.map((item) => item.id)).toEqual([`shot-added:${REF}:AC-1:ar`]);

    expect(await approveItems(snap, items, "2026-11-23T11:00:00.000Z")).toEqual([`shot-added:${REF}:AC-1:ar`]);

    const baseline = await readBaseline(root);

    expect(baseline?.shots.map((shot) => `${shot.criterion}.${shot.language}`).sort()).toEqual(["AC-1.ar", "AC-1.en", "AC-1.fr", "AC-2.en"]);
    expect(readFileSync(path.join(root, "grimoire/screenshots/approved", REF, "AC-1.ar.png"))).toEqual(WHITE);
    expect(baseline?.flows.find((entry) => entry.ref === REF)?.criteria).toHaveLength(3);
  });

  it("approves a structure change and a removed image", async () => {
    const { root, snap } = await setup();

    await approveItems(snap, selectDrift(snap, { targets: [`criterion-added:${REF}:AC-4`, `shot-removed:${REF}:AC-1:fr`, "flow-removed:shop/cart", `case-removed:${REF}:duplicate`, `proof-removed:${REF}:AC-1`] }));

    const baseline = await readBaseline(root);
    const approved = baseline?.flows.find((entry) => entry.ref === REF);

    expect(approved?.criteria.map((entry) => entry.id)).toEqual(["AC-1", "AC-2", "AC-3", "AC-4"]);
    expect(approved?.cases).toEqual(["invalid input"]);
    expect(baseline?.flows.map((entry) => entry.ref)).toEqual([REF]);
    expect(baseline?.shots.some((shot) => shot.language === "fr")).toBe(false);
    expect(existsSync(path.join(root, "grimoire/screenshots/approved", REF, "AC-1.fr.png"))).toBe(false);
    expect(baseline?.proofs.map((entry) => entry.criterion)).toEqual(["AC-2"]);
  });

  it("records a rejection and clears it when the change is approved", async () => {
    const { root, snap } = await setup();
    const items = selectDrift(snap, { targets: [`shot-changed:${REF}:AC-1:en`] });

    await rejectItems(snap, items, "too dark", "2026-11-23T11:00:00.000Z");

    const rejected = await readBaseline(root);

    expect(rejected?.rejected).toEqual([
      { id: `shot-changed:${REF}:AC-1:en`, rejectedAt: "2026-11-23T11:00:00.000Z", note: "too dark" },
    ]);

    const reloaded = { ...snap, shots: { ...snap.shots!, baseline: rejected! } };

    await approveItems(reloaded, items);

    expect((await readBaseline(root))?.rejected).toEqual([]);
  });

  it("throws GR9010 for a target nothing matches", async () => {
    const { snap } = await setup();

    expect(() => selectDrift(snap, { targets: ["nothing/here"] })).toThrow(/Nothing to approve/);
    expect(() => selectDrift(snap, { targets: ["shot-added:no/such:AC-1:en"] })).toThrow(/Nothing to approve/);
    expect(() => selectDrift(snap, { targets: [] })).toThrow(/Name what/);
  });

  it("creates the baseline from the current state with no baseline", async () => {
    const { root, snap } = await setup();
    const fresh = { ...snap, shots: { ...snap.shots!, baseline: null, drift: [] } };

    expect(await approveItems(fresh, [], "2026-11-23T11:00:00.000Z", { createWhenMissing: true })).toEqual(["baseline"]);

    const baseline = await readBaseline(root);

    expect(baseline?.flows.map((entry) => entry.ref).sort()).toEqual([REF, "shop/new"]);
    expect(baseline?.shots.map((shot) => `${shot.criterion}.${shot.language}`).sort()).toEqual(["AC-1.ar", "AC-1.en", "AC-2.en"]);
    expect(existsSync(path.join(root, "grimoire/screenshots/approved", REF, "AC-1.ar.png"))).toBe(true);
  });
});

describe("the capture index", () => {
  it("keeps the entries a run did not run", async () => {
    const { root } = await setup();
    const before = mergeCaptures(null, [capture("AC-1", "en", WHITE), capture("AC-1", "ar", WHITE)], "t1");

    await writeCaptureIndex(root, before);

    const after = mergeCaptures(await readCaptureIndex(root), [capture("AC-1", "ar", BLACK, "fail")], "t2");

    expect(after.captures.map((entry) => `${entry.language}:${entry.outcome}`)).toEqual(["ar:fail", "en:pass"]);
    expect(after.updatedAt).toBe("t2");
  });
});

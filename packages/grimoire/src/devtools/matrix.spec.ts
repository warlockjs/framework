import { describe, expect, it } from "vitest";
import { bookmap, feature, flow, snapshot } from "../../tests/check/snapshot-builder";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import { DEFAULT_GRIMOIRE_SETTINGS } from "../contracts/settings";
import type { ApprovedBaseline, DriftItem, ShotsState } from "../contracts/shots";
import type { CriterionStatus } from "../contracts/test-results";
import { matrix } from "./matrix";

/** A project with the given features; each flow's criteria get the given test statuses. */
function project(
  features: ReturnType<typeof feature>[],
  statuses: Record<string, CriterionStatus> = {},
  patch: Partial<GrimoireSnapshot> = {},
): GrimoireSnapshot {
  const base = snapshot(patch);
  const flows = Object.fromEntries(
    features
      .flatMap((item) => item.flows)
      .map((item) => {
        const map = bookmap(item, []);

        map.criteria = item.criteria.map((criterion) => ({
          id: criterion.id,
          app: criterion.app,
          text: criterion.text,
          tests: [],
          status: statuses[`${item.ref} ${criterion.id}`] ?? "no-test",
        }));

        return [item.ref, map];
      }),
  );

  return {
    ...base,
    written: { ...base.written, features },
    collected: { ...base.collected, flows },
  };
}

const settings = (languages: string[]) => ({
  ...DEFAULT_GRIMOIRE_SETTINGS,
  languages,
  languagesFrom: "settings" as const,
});

const baseline = (flows: ApprovedBaseline["flows"], shots: ApprovedBaseline["shots"] = []) => ({
  schemaVersion: 1 as const,
  approvedAt: "2026-11-20T10:00:00.000Z",
  flows,
  proofs: [],
  shots,
  rejected: [],
});

const shotsState = (patch: Partial<ShotsState>): ShotsState => ({
  mode: "changed",
  shows: [],
  showsFindings: [],
  captures: null,
  baseline: null,
  drift: [],
  optedOut: [],
  ...patch,
});

const showsLine = (ref: string, criterion: string) => {
  const [feature = "", flow = ""] = ref.split("/");

  return {
    feature,
    flow,
    ref,
    criterion,
    call: { line: 10 },
    at: { file: "e2e/shows.e2e.ts", line: 9, column: null },
  };
};

const capture = (
  ref: string,
  criterion: string,
  language: string,
  outcome: "pass" | "fail",
  file: string | null = `captured/${ref}/${criterion}.${language}.png`,
) => ({
  ref,
  criterion,
  language,
  file,
  sha256: file === null ? null : "abc",
  outcome,
  error: outcome === "fail" ? "the field is missing" : null,
  viewport: { name: "desktop", width: 1280, height: 800 },
  spec: "e2e/shows.e2e.ts",
  ranAt: "2026-11-21T10:00:00.000Z",
});

const drift = (patch: Partial<DriftItem>): DriftItem => ({
  id: "shot-changed:contact/send-message:AC-1:ar",
  type: "shot-changed",
  ref: "contact/send-message",
  criterion: "AC-1",
  language: "ar",
  case: null,
  before: null,
  after: null,
  approvedShot: "approved/contact/send-message/AC-1.ar.png",
  capturedShot: "captured/contact/send-message/AC-1.ar.png",
  rejected: null,
  ...patch,
});

const contact = () =>
  feature("contact", {
    flows: [
      flow("contact", "send-message", {
        criteria: ["AC-1", ["AC-2", "web"]],
        differs: ["web", "mobile"],
      }),
    ],
  });

describe("the bird-view matrix", () => {
  it("has one column named empty when the app names no language", () => {
    const answer = matrix(project([contact()], { "contact/send-message AC-1": "pass" }));

    expect(answer.languages).toEqual([""]);
    expect(answer.mode).toBe("changed");
    expect(answer.baseline).toBeNull();

    const row = answer.features[0]?.flows[0]?.criteria[0];

    expect(row?.cells).toHaveLength(1);
    expect(row?.cells[0]).toMatchObject({ language: "", test: "pass", state: "pass" });
  });

  it("shows only the test status without screenshots and without a baseline", () => {
    const answer = matrix(
      project([contact()], {
        "contact/send-message AC-1": "fail",
        "contact/send-message AC-2": "stale",
      }),
    );
    const cells = answer.features[0]?.flows[0]?.criteria.flatMap((row) => row.cells) ?? [];

    expect(cells.map((cell) => cell.shown)).toEqual([null, null]);
    expect(cells.map((cell) => cell.approval)).toEqual([null, null]);
    expect(cells.map((cell) => cell.state)).toEqual(["fail", "stale"]);
    expect(answer.counts).toMatchObject({ fail: 1, stale: 1, pass: 0 });
    expect(answer.drift).toEqual([]);
  });

  it("makes one cell per language and carries the app scope and the apps a flow differs in", () => {
    const answer = matrix(project([contact()], {}, { settings: settings(["en", "ar"]) }));
    const flowRow = answer.features[0]?.flows[0];

    expect(answer.languages).toEqual(["en", "ar"]);
    expect(flowRow?.differsIn).toEqual(["web", "mobile"]);
    expect(flowRow?.criteria.map((row) => row.app)).toEqual([null, "web"]);
    expect(flowRow?.criteria[0]?.cells.map((cell) => cell.language)).toEqual(["en", "ar"]);
    expect(answer.counts["no-test"]).toBe(4);
  });

  it("lists the design system first", () => {
    const design = feature("design-system", {
      flows: [flow("design-system", "direction", { criteria: ["AC-1"] })],
    });
    const answer = matrix(project([contact(), design]));

    expect(answer.features.map((item) => item.id)).toEqual(["design-system", "contact"]);
    expect(answer.features.map((item) => item.designSystem)).toEqual([true, false]);
  });

  it("reads each language's capture and marks a failed one red", () => {
    const shots = shotsState({
      shows: [showsLine("contact/send-message", "AC-1")],
      captures: {
        schemaVersion: 1,
        updatedAt: "2026-11-21T10:00:00.000Z",
        captures: [
          capture("contact/send-message", "AC-1", "en", "pass"),
          capture("contact/send-message", "AC-1", "ar", "fail", null),
        ],
      },
    });
    const answer = matrix(
      project(
        [contact()],
        { "contact/send-message AC-1": "pass", "contact/send-message AC-2": "pass" },
        { settings: settings(["en", "ar", "fr"]), shots },
      ),
    );
    const [first, second] = answer.features[0]?.flows[0]?.criteria ?? [];

    expect(first?.cells.map((cell) => cell.shown?.outcome)).toEqual(["pass", "fail", "not-run"]);
    expect(first?.cells[0]?.shown?.shot).toBe("captured/contact/send-message/AC-1.en.png");
    expect(first?.cells[1]?.shown?.shot).toBeNull();
    expect(first?.cells.map((cell) => cell.state)).toEqual(["pass", "fail", "not-run"]);
    // AC-2 has no scene.
    expect(second?.cells.map((cell) => cell.shown)).toEqual([null, null, null]);
  });

  it("marks a changed screenshot as changed and a rejected one as rejected", () => {
    const changed = drift({});
    const rejected = drift({
      id: "shot-changed:contact/send-message:AC-1:en",
      language: "en",
      rejected: {
        id: "shot-changed:contact/send-message:AC-1:en",
        rejectedAt: "2026-11-22T10:00:00.000Z",
        note: null,
      },
    });
    const shots = shotsState({
      shows: [showsLine("contact/send-message", "AC-1")],
      baseline: baseline(
        [
          {
            ref: "contact/send-message",
            criteria: [
              { id: "AC-1", text: "criterion AC-1" },
              { id: "AC-2", text: "criterion AC-2" },
            ],
            cases: [],
          },
        ],
        [
          {
            ref: "contact/send-message",
            criterion: "AC-1",
            language: "ar",
            file: "approved/contact/send-message/AC-1.ar.png",
            sha256: "old",
            approvedAt: "2026-11-20T10:00:00.000Z",
          },
        ],
      ),
      drift: [changed, rejected],
    });
    const answer = matrix(
      project(
        [contact()],
        { "contact/send-message AC-1": "pass", "contact/send-message AC-2": "pass" },
        { settings: settings(["en", "ar", "fr"]), shots },
      ),
    );
    const cells = answer.features[0]?.flows[0]?.criteria[0]?.cells ?? [];

    expect(answer.baseline).toEqual({ approvedAt: "2026-11-20T10:00:00.000Z" });
    expect(cells.map((cell) => cell.approval)).toEqual(["rejected", "changed", "approved"]);
    expect(cells.map((cell) => cell.state)).toEqual(["rejected", "changed", "not-run"]);
    expect(cells[1]?.drift).toEqual([changed.id]);
    expect(cells[1]?.shown?.approved).toBe("approved/contact/send-message/AC-1.ar.png");
    expect(answer.drift).toHaveLength(2);
    expect(answer.counts).toMatchObject({ rejected: 1, changed: 1 });
  });

  it("lists a criterion of the baseline that is no longer written as removed and changed", () => {
    const removed = drift({
      id: "criterion-removed:contact/send-message:AC-9",
      type: "criterion-removed",
      criterion: "AC-9",
      language: null,
      approvedShot: null,
      capturedShot: null,
    });
    const shots = shotsState({
      baseline: baseline([
        {
          ref: "contact/send-message",
          criteria: [
            { id: "AC-1", text: "criterion AC-1" },
            { id: "AC-9", text: "the old rule" },
          ],
          cases: [],
        },
      ]),
      drift: [removed],
    });
    const answer = matrix(project([contact()], {}, { settings: settings(["en", "ar"]), shots }));
    const rows = answer.features[0]?.flows[0]?.criteria ?? [];
    const old = rows.find((row) => row.id === "AC-9");

    expect(old).toMatchObject({ removed: true, text: "the old rule" });
    expect(old?.cells.map((cell) => cell.state)).toEqual(["changed", "changed"]);
    expect(old?.cells[0]?.drift).toEqual([removed.id]);
    expect(rows.filter((row) => !row.removed)).toHaveLength(2);
  });

  it("lists a flow of the baseline that is no longer written, with its feature", () => {
    const shots = shotsState({
      baseline: baseline([
        {
          ref: "billing/invoice",
          criteria: [{ id: "AC-1", text: "an invoice is sent" }],
          cases: [],
        },
      ]),
      drift: [
        drift({
          id: "flow-removed:billing/invoice",
          type: "flow-removed",
          ref: "billing/invoice",
          criterion: null,
          language: null,
          approvedShot: null,
          capturedShot: null,
        }),
      ],
    });
    const answer = matrix(project([contact()], {}, { shots }));
    const billing = answer.features.find((item) => item.id === "billing");

    expect(billing?.flows[0]).toMatchObject({
      ref: "billing/invoice",
      removed: true,
      drift: ["flow-removed:billing/invoice"],
    });
    expect(billing?.flows[0]?.criteria[0]?.cells[0]?.state).toBe("changed");
    // The cell's panel lists the removal, so it can be approved from there.
    expect(billing?.flows[0]?.criteria[0]?.cells[0]?.drift).toEqual([
      "flow-removed:billing/invoice",
    ]);
  });

  it("keeps the drift of a flow itself on the flow row", () => {
    const caseRemoved = drift({
      id: "case-removed:contact/send-message:server error",
      type: "case-removed",
      criterion: null,
      language: null,
      case: "server error",
      approvedShot: null,
      capturedShot: null,
    });
    const shots = shotsState({
      baseline: baseline([
        {
          ref: "contact/send-message",
          criteria: [
            { id: "AC-1", text: "criterion AC-1" },
            { id: "AC-2", text: "criterion AC-2" },
          ],
          cases: ["server error"],
        },
      ]),
      drift: [caseRemoved],
    });
    const answer = matrix(project([contact()], {}, { shots }));
    const row = answer.features[0]?.flows[0];

    expect(row?.drift).toEqual([caseRemoved.id]);
    // The flow's own change does not turn its criteria into changes.
    expect(row?.criteria.flatMap((item) => item.cells.map((cell) => cell.approval))).toEqual([
      "approved",
      "approved",
    ]);
  });

  it("marks a flow that opted out of screenshots", () => {
    const optedOut = project([contact()]);
    const target = optedOut.written.features[0]?.flows[0];

    if (target !== undefined) target.screenshots = { value: false, at: target.id.at };

    expect(matrix(optedOut).features[0]?.flows[0]?.screenshots).toBe(false);
    expect(
      matrix(
        project([contact()], {}, { shots: shotsState({ optedOut: ["contact/send-message"] }) }),
      ).features[0]?.flows[0]?.screenshots,
    ).toBe(false);
    expect(matrix(project([contact()])).features[0]?.flows[0]?.screenshots).toBe(true);
  });

  it("never waits for a capture of a flow without screenshots (opted out, or the mode is off)", () => {
    const shows = [showsLine("contact/send-message", "AC-1")];
    const statuses = { "contact/send-message AC-1": "pass" as const };
    const cells = (shots: ShotsState) =>
      matrix(project([contact()], statuses, { settings: settings(["en"]), shots })).features[0]
        ?.flows[0]?.criteria[0]?.cells;

    expect(cells(shotsState({ shows }))?.[0]?.state).toBe("not-run");
    expect(cells(shotsState({ shows, optedOut: ["contact/send-message"] }))?.[0]).toMatchObject({
      shown: null,
      state: "pass",
    });
    expect(cells(shotsState({ shows, mode: "off" }))?.[0]).toMatchObject({
      shown: null,
      state: "pass",
    });
  });

  it("keeps an approved image standing when changed mode did not capture the flow", () => {
    const shows = [showsLine("contact/send-message", "AC-1")];
    const approvedShot = {
      ref: "contact/send-message",
      criterion: "AC-1",
      language: "en",
      file: "approved/contact/send-message/AC-1.en.png",
      sha256: "abc",
      approvedAt: "2026-11-20T10:00:00.000Z",
    };
    const flows = baseline([], [approvedShot]);
    const cell = (mode: "changed" | "all") =>
      matrix(
        project(
          [contact()],
          { "contact/send-message AC-1": "pass" },
          {
            settings: settings(["en"]),
            shots: shotsState({ shows, mode, baseline: { ...flows, flows: [] } }),
          },
        ),
      ).features[0]?.flows[0]?.criteria[0]?.cells[0];

    expect(cell("changed")?.shown).toMatchObject({
      outcome: "pass",
      shot: null,
      approved: approvedShot.file,
    });
    expect(cell("all")?.shown?.outcome).toBe("not-run");
  });

  it("takes the mode of the screenshots state, else of the settings", () => {
    expect(matrix(project([contact()], {}, { shots: shotsState({ mode: "off" }) })).mode).toBe(
      "off",
    );
    expect(
      matrix(project([contact()], {}, { settings: { ...settings([]), screenshots: "all" } })).mode,
    ).toBe("all");
  });
});

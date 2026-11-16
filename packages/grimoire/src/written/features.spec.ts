import { describe, expect, it } from "vitest";
import type { GrimoireFinding } from "../contracts/findings";
import {
  parseChangelog,
  parseFeatureReadme,
  parseFlow,
  parseVersionBrief,
  splitEntryText,
} from "./features";
import { FindingSink } from "./sink";

function collect(): {
  sink: FindingSink;
  findings: GrimoireFinding[];
  codes: () => [string, number | undefined][];
} {
  const findings: GrimoireFinding[] = [];

  return {
    sink: new FindingSink(findings),
    findings,
    codes: () => findings.map((finding) => [finding.code, finding.at?.line]),
  };
}

const FLOW = "grimoire/features/catalog/flows/wishlist.md";

function flowText(
  body: string[],
  frontMatter = ["id: wishlist", "since: 3.0", "status: proposed", "who: customer"],
): string {
  return ["---", ...frontMatter, "---", "", "# Save", "", ...body].join("\n");
}

const ALL_CASES = [
  "## Cases",
  "- invalid input   a",
  "- not allowed   b",
  "- not found   c",
  "- duplicate   d",
  "- limits   e",
  "- expiry   does not apply: f",
  "- double submit   g",
  "- outside service down   h",
];

describe("parseFlow", () => {
  it("reads every step kind, notes, routes and affects targets", () => {
    const { sink, findings } = collect();
    const flow = parseFlow(
      FLOW,
      flowText([
        "## Steps",
        "1. page   /products/:id",
        "2. route\tpost /api/wishlist — saves it",
        "3. outside service   payment gateway -- may be slow",
        "4. affects   orders/place-order",
        "5. mail   m",
        "6. notification   n",
        "7. job   j",
        "8. event   order.placed",
        "",
        ...ALL_CASES,
        "",
        "## Acceptance criteria",
        "- AC-1   one",
      ]),
      "catalog",
      "wishlist",
      sink,
    );

    expect(findings).toEqual([]);
    expect(flow.ref).toBe("catalog/wishlist");
    expect(flow.steps.map((step) => [step.index, step.type, step.target, step.note])).toEqual([
      [1, "page", "/products/:id", null],
      [2, "route", "post /api/wishlist", "saves it"],
      [3, "outside service", "payment gateway", "may be slow"],
      [4, "affects", "orders/place-order", null],
      [5, "mail", "m", null],
      [6, "notification", "n", null],
      [7, "job", "j", null],
      [8, "event", "order.placed", null],
    ]);
    expect(flow.steps[1]?.route).toEqual({ method: "POST", path: "/api/wishlist" });
    expect(flow.steps[3]?.affects).toEqual({ feature: "orders", flow: "place-order" });
    expect(flow.steps[0]?.at).toEqual({ file: FLOW, line: 11, column: null });
    expect(flow.cases.find((entry) => entry.question === "expiry")?.doesNotApply).toBe(true);
  });

  it("reports malformed steps, unknown kinds and numbering", () => {
    const { sink, codes } = collect();

    parseFlow(
      FLOW,
      flowText([
        "## Steps",
        "1. route   /api/wishlist",
        "2. request   POST /x",
        "3. page",
        "- page   /x",
        "5. affects   Orders",
        "",
        ...ALL_CASES,
        "## Acceptance criteria",
      ]),
      "catalog",
      "wishlist",
      sink,
    );

    expect(codes()).toEqual([
      ["GR1008", 11],
      ["GR1009", 12],
      ["GR1008", 13],
      ["GR1008", 14],
      ["GR1008", 15],
      ["GR1010", 15],
    ]);
  });

  it("reads cases, Not handled, Unknown lines and scoped criteria; reports bad ones", () => {
    const { sink, codes } = collect();
    const flow = parseFlow(
      FLOW,
      flowText([
        "## Steps",
        "## Cases",
        "* Invalid Input   a",
        "- limits",
        "- my own case   c",
        "## Not handled",
        "- not found   d",
        "- duplicate   e",
        "Unknown: why?",
        "## Acceptance criteria",
        "- AC-1 [mobile]   one",
        "  continued",
        "- AC-1   again",
        "- AC2   bad",
        "- AC-3 [Mobile]   bad app",
        "```",
        "Unknown: not read",
        "```",
      ]),
      "catalog",
      "wishlist",
      sink,
    );

    expect(flow.cases.map((entry) => [entry.question, entry.fixed])).toEqual([
      ["invalid input", true],
      ["my own case", false],
    ]);
    expect(flow.notHandled.map((line) => line.name)).toEqual(["not found", "duplicate"]);
    expect(flow.unknowns).toEqual([{ text: "why?", at: { file: FLOW, line: 18, column: null } }]);
    expect(flow.criteria).toEqual([
      {
        id: "AC-1",
        number: 1,
        app: "mobile",
        text: "one continued",
        at: { file: FLOW, line: 20, column: null },
      },
    ]);
    expect(codes()).toEqual([
      ["GR1011", 13],
      ["GR1014", 22],
      ["GR1013", 23],
      ["GR1013", 24],
      // not allowed, limits, expiry, double submit, outside service down are unanswered
      ["GR1012", 11],
      ["GR1012", 11],
      ["GR1012", 11],
      ["GR1012", 11],
      ["GR1012", 11],
    ]);
  });

  it("reports a case question written with no answer, in Cases and in Not handled", () => {
    const { sink, findings } = collect();
    const flow = parseFlow(
      FLOW,
      flowText([
        "## Steps",
        "## Cases",
        "- invalid input   a",
        "- not allowed   b",
        "- not found   c",
        "- duplicate   d",
        "- limits   e",
        "- expiry   f",
        "- outside service down   g",
        "- Double Submit",
        "## Not handled",
        "- double submit",
        "## Acceptance criteria",
      ]),
      "catalog",
      "wishlist",
      sink,
    );

    expect(flow.cases.map((entry) => entry.question)).not.toContain("double");
    expect(flow.notHandled).toEqual([]);
    expect(findings.map((finding) => [finding.code, finding.at?.line, finding.message])).toEqual([
      ["GR1011", 19, 'the case "- Double Submit" is not `- <question>   <answer>`.'],
      [
        "GR1028",
        21,
        'the Not handled line "- double submit" is not `- name   text` (the name, spaces, then the text).',
      ],
      [
        "GR1012",
        11,
        'the case question "double submit" is answered neither under Cases nor under Not handled.',
      ],
    ]);
  });

  it("reads lines whose spaces a Markdown formatter collapsed to one", () => {
    const { sink, findings } = collect();
    const flow = parseFlow(
      FLOW,
      flowText([
        "## Steps",
        "",
        "1. page /products/:id",
        "2. route POST /wishlist — saves it",
        "3. outside service payment gateway",
        "4. request POST /x",
        "",
        "## Differs by app",
        "",
        "- mobile the save button is also on the product card",
        "",
        "## Cases",
        "",
        "- invalid input a product id that is not an id → 422",
        "- Not Allowed guest → sent to sign in",
        "- not found the product does not exist → 404",
        "- duplicate already saved → stays saved",
        "- limits at most 200 products",
        "- expiry does not apply: saved products do not expire",
        "- outside service down does not apply",
        "- payment declined   the card is refused → 402",
        "",
        "## Not handled",
        "",
        "- double submit two taps can save twice",
        "",
        "## Acceptance criteria",
        "",
        "- AC-1 a saved product appears on /wishlist",
        "- AC-2 [mobile] the product card has a save button",
      ]),
      "catalog",
      "wishlist",
      sink,
    );

    expect(findings.map((finding) => [finding.code, finding.at?.line])).toEqual([["GR1009", 15]]);
    expect(flow.steps.map((step) => [step.type, step.target, step.note])).toEqual([
      ["page", "/products/:id", null],
      ["route", "POST /wishlist", "saves it"],
      ["outside service", "payment gateway", null],
    ]);
    expect(flow.differs.map((line) => [line.name, line.text])).toEqual([
      ["mobile", "the save button is also on the product card"],
    ]);
    expect(flow.cases.map((entry) => [entry.question, entry.fixed, entry.answer])).toEqual([
      ["invalid input", true, "a product id that is not an id → 422"],
      ["not allowed", true, "guest → sent to sign in"],
      ["not found", true, "the product does not exist → 404"],
      ["duplicate", true, "already saved → stays saved"],
      ["limits", true, "at most 200 products"],
      ["expiry", true, "does not apply: saved products do not expire"],
      ["outside service down", true, "does not apply"],
      ["payment declined", false, "the card is refused → 402"],
    ]);
    expect(flow.notHandled.map((line) => [line.name, line.text])).toEqual([
      ["double submit", "two taps can save twice"],
    ]);
    expect(flow.criteria.map((criterion) => [criterion.id, criterion.app, criterion.text])).toEqual(
      [
        ["AC-1", null, "a saved product appears on /wishlist"],
        ["AC-2", "mobile", "the product card has a save button"],
      ],
    );
  });

  it("checks the front matter: required keys, forms, unknown keys, the id against the file name", () => {
    const { sink, findings } = collect();
    const flow = parseFlow(
      FLOW,
      flowText(
        ["## Steps", ...ALL_CASES, "## Acceptance criteria"],
        ["id: wish-list", "since: three", "status: done", "origin: guessed", "owner: me"],
      ),
      "catalog",
      "wishlist",
      sink,
    );

    expect(findings.map((finding) => [finding.code, finding.at?.line, finding.message])).toEqual([
      [
        "GR1005",
        6,
        'the front matter key "owner" is not part of the flow template (id, since, status, who, origin).',
      ],
      ["GR1019", 2, 'the flow id "wish-list" must equal its "wishlist" name.'],
      [
        "GR1004",
        3,
        'the front matter key "since" is "three"; write a version as <whole>.<decimal>, like 2.1.',
      ],
      [
        "GR1004",
        4,
        'the front matter key "status" is "done"; use one of: proposed, building, shipped, retired.',
      ],
      ["GR1003", 1, 'the front matter key "who" is missing.'],
      ["GR1004", 5, 'the front matter key "origin" is "guessed"; use one of: inferred, confirmed.'],
    ]);
    expect(flow.status.value).toBe("building");
    expect(flow.who).toEqual({ value: "", at: { file: FLOW, line: 1, column: null } });
    expect(flow.origin).toBeNull();
  });
});

describe("parseFeatureReadme", () => {
  const README = "grimoire/features/catalog/README.md";

  it("normalises folders written with backslashes or ./, and reads relations", () => {
    const { sink, findings } = collect();
    const readme = parseFeatureReadme(
      README,
      [
        "---",
        "id: catalog",
        "title: Catalog",
        "status: shipped",
        "version: 2.1",
        "updated: 2026-02-28",
        "apps: [web-client]",
        "folders: [src\\app\\catalog, ./src/web/$sites/client/products/]",
        "---",
        "# Catalog",
        "## Flows",
        "- browse   list products",
        "- Browse Products   bad id",
        "## Affects and affected by",
        "- affects orders/place-order and auth/login",
      ].join("\n"),
      "catalog",
      sink,
    );

    expect(readme.folders.map((folder) => folder.value)).toEqual([
      "src/app/catalog",
      "src/web/$sites/client/products",
    ]);
    expect(readme.flows.map((line) => line.name)).toEqual(["browse"]);
    expect(readme.relations[0]?.refs).toEqual(["orders/place-order", "auth/login"]);
    expect(findings.map((finding) => [finding.code, finding.at?.line])).toEqual([["GR1028", 13]]);
  });

  it("reports bad dates, absolute folders, list items and a missing title", () => {
    const { sink, findings } = collect();

    parseFeatureReadme(
      README,
      [
        "---",
        "id: catalog",
        "title:",
        "status: shipped",
        "version: 2",
        "updated: 2026-02-30",
        "apps:",
        "  - web-client",
        "  - Mobile",
        "folders: [/abs, ../up]",
        "---",
        "text",
      ].join("\n"),
      "catalog",
      sink,
    );

    expect(findings.map((finding) => [finding.code, finding.at?.line])).toEqual([
      ["GR1004", 3],
      ["GR1004", 5],
      ["GR1004", 6],
      ["GR1004", 9],
      ["GR1004", 10],
      ["GR1004", 10],
      ["GR1006", 12],
    ]);
  });
});

describe("parseChangelog", () => {
  const CHANGELOG = "grimoire/features/catalog/CHANGELOG.md";

  it("reads unreleased and released sections, flows, criteria and continuation lines", () => {
    const { sink, findings } = collect();
    const changelog = parseChangelog(
      CHANGELOG,
      [
        "# Changelog",
        "## Unreleased",
        "- 2.1  fixed   new-arrivals: an empty list",
        "               for some (AC-2, AC-3)",
        "",
        "## 1.0.0 (2026-10-01)",
        "* 1.0\tadded\tdescribed",
      ].join("\r\n"),
      "catalog",
      sink,
    );

    expect(findings).toEqual([]);
    expect(
      changelog.sections.map((section) => [section.release, section.date, section.at.line]),
    ).toEqual([
      [null, null, 2],
      ["1.0.0", "2026-10-01", 6],
    ]);
    expect(
      changelog.entries.map((entry) => [
        entry.version.value,
        entry.word,
        entry.flow,
        entry.criteria,
        entry.text,
        entry.release,
        entry.date,
      ]),
    ).toEqual([
      ["2.1", "fixed", "new-arrivals", ["AC-2", "AC-3"], "an empty list for some", null, null],
      ["1.0", "added", null, [], "described", "1.0.0", "2026-10-01"],
    ]);
  });

  it("reports malformed lines, unknown words, bad and repeated headings", () => {
    const { sink, findings } = collect();
    const changelog = parseChangelog(
      CHANGELOG,
      [
        "- 1.0  added   before any heading",
        "## Unreleased",
        "- 2.1",
        "- 2.1  tweaked   x",
        "- v2  fixed   x",
        "a stray line",
        "## 1.1.0 - 2026-10-01",
        "## 1.0.0 (2026-13-01)",
        "### 1.0.0",
        "## Unreleased",
      ].join("\n"),
      "catalog",
      sink,
    );

    expect(findings.map((finding) => [finding.code, finding.at?.line])).toEqual([
      ["GR1015", 1],
      ["GR1015", 3],
      ["GR1016", 4],
      ["GR1015", 5],
      ["GR1015", 6],
      ["GR1017", 7],
      ["GR1017", 8],
      ["GR1017", 9],
      ["GR1017", 10],
    ]);
    expect(changelog.entries.map((entry) => entry.text)).toEqual(["before any heading"]);
  });
});

describe("splitEntryText", () => {
  it("splits the flow prefix and the trailing criteria", () => {
    expect(splitEntryText("wishlist: saves (AC-1,AC-2)")).toEqual({
      flow: "wishlist",
      criteria: ["AC-1", "AC-2"],
      text: "saves",
    });
    expect(splitEntryText("Note: free text (see AC-1)")).toEqual({
      flow: null,
      criteria: [],
      text: "Note: free text (see AC-1)",
    });
  });
});

describe("parseVersionBrief", () => {
  it("reads the title; front matter keys are reported as not in the template", () => {
    const { sink, findings } = collect();
    const brief = parseVersionBrief(
      "grimoire/features/catalog/versions/v3.md",
      "---\nid: v3\n---\n# Catalog 3.0\n",
      "catalog",
      3,
      sink,
    );

    expect(brief.heading?.value).toBe("Catalog 3.0");
    expect(brief.major).toBe(3);
    expect(findings.map((finding) => finding.code)).toEqual(["GR1005"]);
  });
});

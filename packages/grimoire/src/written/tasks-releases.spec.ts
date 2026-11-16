import { describe, expect, it } from "vitest";
import { COLLECTED_END_MARKER, COLLECTED_START_MARKER } from "../contracts/written";
import type { GrimoireFinding } from "../contracts/findings";
import { FindingSink } from "./sink";
import { parseRelease, parseTask } from "./tasks-releases";

function collect(): { sink: FindingSink; findings: GrimoireFinding[] } {
  const findings: GrimoireFinding[] = [];

  return { sink: new FindingSink(findings), findings };
}

const TASK = "grimoire/tasks/open/T-14-wishlist.md";
const RELEASE = "grimoire/releases/1.1.0.md";

describe("parseTask", () => {
  it("reads the front matter, the title and the `- Key: value` fields", () => {
    const { sink, findings } = collect();
    const task = parseTask(
      TASK,
      [
        "---",
        "id: T-14",
        "type: feature",
        "feature: catalog",
        "flow: catalog/wishlist",
        "apps: [web-client]",
        "status: waiting for approval",
        "---",
        "# Wishlist",
        "- Asked by: the owner",
        "- Decision needed: one list,",
        "  or several?",
        "- a plain bullet",
      ].join("\n"),
      { folder: "open", month: null, nameId: "T-14" },
      sink,
    );

    expect(findings).toEqual([]);
    expect(task.status.value).toBe("waiting for approval");
    expect(task.flow?.value).toBe("catalog/wishlist");
    expect(task.fields.map((field) => [field.key, field.value, field.at.line])).toEqual([
      ["Asked by", "the owner", 10],
      ["Decision needed", "one list, or several?", 11],
    ]);
    expect(task.decisionNeeded).toBe("one list, or several?");
  });

  it("requires shipped in done/ and checks every value's form", () => {
    const { sink, findings } = collect();
    const task = parseTask(
      "grimoire/tasks/done/2026-11/T-10-fix.md",
      ["---", "id: T-11", "type: task", "status: finished", "flow: Wish List", "---", "# Fix"].join(
        "\n",
      ),
      { folder: "done", month: "2026-11", nameId: "T-10" },
      sink,
    );

    expect(task.type.value).toBe("chore");
    expect(task.status.value).toBe("done");
    expect(task.shipped).toBeNull();
    expect(findings.map((finding) => [finding.code, finding.at?.line])).toEqual([
      ["GR1019", 2],
      ["GR1003", 1],
      ["GR1004", 3],
      ["GR1004", 5],
      ["GR1004", 4],
    ]);
  });

  it("reads `shipped: <feature> <version>`", () => {
    const { sink } = collect();
    const task = parseTask(
      "grimoire/tasks/done/2026-11/T-10-fix.md",
      "---\nid: T-10\ntype: bug\nstatus: done\nshipped: catalog 2.1\n---\n",
      { folder: "done", month: "2026-11", nameId: "T-10" },
      sink,
    );

    expect(task.shipped?.value).toEqual({ feature: "catalog", version: "2.1" });
  });
});

describe("parseRelease", () => {
  const head = [
    "---",
    "release: 1.1.0",
    "date: 2026-11-20",
    "---",
    "",
    "# Release 1.1.0",
    "",
    "Customers see new arrivals again.",
  ];

  it("reads the brief and no list before the release command ran", () => {
    const { sink, findings } = collect();
    const release = parseRelease(RELEASE, head.join("\n"), "1.1.0", sink);

    expect(findings).toEqual([]);
    expect(release.brief).toBe("Customers see new arrivals again.");
    expect(release.collected).toBeNull();
  });

  it("reads the collected list back", () => {
    const { sink, findings } = collect();
    const release = parseRelease(
      RELEASE,
      [
        ...head,
        "",
        COLLECTED_START_MARKER,
        "## Changes",
        "",
        "### catalog",
        "- 2.1 fixed new-arrivals: an empty list (AC-2)",
        COLLECTED_END_MARKER,
      ].join("\r\n"),
      "1.1.0",
      sink,
    );

    expect(findings).toEqual([]);
    expect(release.brief).toBe("Customers see new arrivals again.");
    expect(release.collected).toEqual({
      start: { file: RELEASE, line: 10, column: null },
      end: { file: RELEASE, line: 15, column: null },
      entries: [
        {
          feature: "catalog",
          version: "2.1",
          word: "fixed",
          flow: "new-arrivals",
          criteria: ["AC-2"],
          text: "an empty list",
          at: { file: RELEASE, line: 14, column: null },
        },
      ],
    });
  });

  it("reads `No feature changes.` as an empty list", () => {
    const { sink, findings } = collect();
    const release = parseRelease(
      RELEASE,
      [
        ...head,
        COLLECTED_START_MARKER,
        "## Changes",
        "",
        "No feature changes.",
        COLLECTED_END_MARKER,
      ].join("\n"),
      "1.1.0",
      sink,
    );

    expect(findings).toEqual([]);
    expect(release.collected?.entries).toEqual([]);
  });

  it.each([
    ["no end marker", [COLLECTED_START_MARKER], 9],
    ["no start marker", [COLLECTED_END_MARKER], 9],
    ["the end before the start", [COLLECTED_END_MARKER, COLLECTED_START_MARKER], 9],
    [
      "two lists",
      [COLLECTED_START_MARKER, COLLECTED_END_MARKER, COLLECTED_START_MARKER, COLLECTED_END_MARKER],
      11,
    ],
  ])("reports %s as GR1024", (_name, markers, line) => {
    const { sink, findings } = collect();
    const release = parseRelease(RELEASE, [...head, ...markers].join("\n"), "1.1.0", sink);

    expect(release.collected).toBeNull();
    expect(findings.map((finding) => [finding.code, finding.at?.line])).toEqual([["GR1024", line]]);
  });

  it("reports bad list lines, a wrong release name and a missing title", () => {
    const { sink, findings } = collect();

    parseRelease(
      RELEASE,
      [
        "---",
        "release: 1.0.9",
        "date: 2026-11-20",
        "---",
        COLLECTED_START_MARKER,
        "- 2.1 fixed before a feature heading",
        "### catalog",
        "- 2.1 tuned x",
        "- two fixed x",
        "stray",
        COLLECTED_END_MARKER,
      ].join("\n"),
      "1.1.0",
      sink,
    );

    expect(findings.map((finding) => [finding.code, finding.at?.line])).toEqual([
      ["GR1019", 2],
      ["GR1006", 5],
      ["GR1015", 6],
      ["GR1016", 8],
      ["GR1015", 9],
      ["GR1015", 10],
    ]);
  });
});

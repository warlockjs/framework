import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type {
  ChangeWord,
  WrittenChangelogEntry,
  WrittenFeature,
  WrittenGrimoire,
  WrittenRelease,
} from "../contracts/written";
import { COLLECTED_END_MARKER, COLLECTED_START_MARKER } from "../contracts/written";
import { checkReleases, collectRelease, renderCollectedList, writeRelease } from "./index";

const at = (file: string, line = 1) => ({ file, line, column: null });
const located = <T>(value: T, file = "x.md", line = 1) => ({ value, at: at(file, line) });

function entry(
  feature: string,
  version: string,
  word: ChangeWord,
  text: string,
  release: string | null,
  extra: Partial<WrittenChangelogEntry> = {},
): WrittenChangelogEntry {
  const file = `grimoire/features/${feature}/CHANGELOG.md`;

  return {
    feature,
    version: located(version, file),
    word,
    flow: null,
    criteria: [],
    text,
    release,
    date: release === null ? null : "2026-11-20",
    at: at(file, 3),
    ...extra,
  };
}

function feature(id: string, entries: WrittenChangelogEntry[]): WrittenFeature {
  const file = `grimoire/features/${id}/CHANGELOG.md`;
  const sections = [...new Set(entries.map((item) => item.release))].map((release) => ({
    release,
    date: release === null ? null : "2026-11-20",
    at: at(file, 2),
  }));

  return {
    id,
    dir: `grimoire/features/${id}`,
    readme: null,
    changelog: { file, sections, entries },
    flows: [],
    versions: [],
  };
}

function releaseFile(
  release: string,
  brief = "The brief.",
  listed: WrittenRelease["collected"] = null,
): WrittenRelease {
  return {
    file: `grimoire/releases/${release}.md`,
    release: located(release),
    date: located("2026-11-20"),
    heading: located(`Release ${release}`),
    brief,
    collected: listed,
  };
}

function grimoire(
  root: string,
  features: WrittenFeature[],
  releases: WrittenRelease[],
): WrittenGrimoire {
  return { root, exists: true, features, apps: [], tasks: [], releases, hash: "" };
}

const catalog = () =>
  feature("catalog", [
    entry("catalog", "2.1", "fixed", "a customer with no country saw an empty list", "1.1.0", {
      flow: "new-arrivals",
      criteria: ["AC-2", "AC-3"],
    }),
    entry("catalog", "2.2", "changed", "still being built", null),
    entry("catalog", "2.0", "added", "customers see the newest products", "1.0.0", {
      flow: "new-arrivals",
    }),
  ]);
const orders = () =>
  feature("orders", [entry("orders", "3.0", "added", "pay later", "1.1.0", { flow: "pay-later" })]);

describe("collectRelease", () => {
  it("collects only entries stamped with the release, sorted by feature then newest version", () => {
    const written = grimoire("/p", [orders(), catalog()], [releaseFile("1.1.0")]);
    const collection = collectRelease(written, "1.1.0");

    expect(collection.date).toBe("2026-11-20");
    expect(collection.entries.map((item) => `${item.feature} ${item.version}`)).toEqual([
      "catalog 2.1",
      "orders 3.0",
    ]);
    expect(collection.entries.every((item) => item.state === "stamped")).toBe(true);
  });

  it("never collects entries still under Unreleased", () => {
    const written = grimoire("/p", [catalog()], [releaseFile("1.1.0")]);

    expect(collectRelease(written, "1.1.0").entries.map((item) => item.text)).not.toContain(
      "still being built",
    );
  });

  it("collects an older release again without sweeping newer entries in", () => {
    const written = grimoire(
      "/p",
      [catalog(), orders()],
      [releaseFile("1.0.0"), releaseFile("1.1.0")],
    );

    expect(collectRelease(written, "1.0.0").entries.map((item) => item.version)).toEqual(["2.0"]);
  });

  it("throws GR9005 when the release file is missing", () => {
    expect(() => collectRelease(grimoire("/p", [], []), "9.9.9")).toThrow(/GR9005|does not exist/);
  });

  it("throws GR9005 when the brief is empty", () => {
    const written = grimoire("/p", [], [releaseFile("1.1.0", "  \n")]);

    expect(() => collectRelease(written, "1.1.0")).toThrow(/no brief/);
  });
});

describe("renderCollectedList", () => {
  it("writes the markers, features and entry lines", () => {
    const written = grimoire("/p", [orders(), catalog()], [releaseFile("1.1.0")]);
    const text = renderCollectedList(collectRelease(written, "1.1.0"));

    expect(text).toBe(
      [
        COLLECTED_START_MARKER,
        "## Changes",
        "",
        "### catalog",
        "- 2.1  fixed  new-arrivals: a customer with no country saw an empty list (AC-2, AC-3)",
        "",
        "### orders",
        "- 3.0  added  pay-later: pay later",
        COLLECTED_END_MARKER,
      ].join("\n"),
    );
  });

  it("says so when there are no entries", () => {
    const text = renderCollectedList({ release: "2.0.0", date: "2026-11-20", entries: [] });

    expect(text).toBe(`${COLLECTED_START_MARKER}\nNo feature changes.\n${COLLECTED_END_MARKER}`);
  });
});

describe("writeRelease", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function project(releaseText: string, written: (root: string) => WrittenGrimoire) {
    const root = mkdtempSync(path.join(tmpdir(), "grimoire-release-"));

    roots.push(root);
    mkdirSync(path.join(root, "grimoire/releases"), { recursive: true });
    mkdirSync(path.join(root, "grimoire/features/catalog"), { recursive: true });
    writeFileSync(path.join(root, "grimoire/releases/1.1.0.md"), releaseText);
    writeFileSync(
      path.join(root, "grimoire/features/catalog/CHANGELOG.md"),
      "## Unreleased\n- 2.2  changed  x\n",
    );

    return { root, written: written(root) };
  }

  const brief =
    "---\nrelease: 1.1.0\ndate: 2026-11-20\n---\n\n# Release 1.1.0\n\nThe agent's brief.\n";
  const build = (root: string) => grimoire(root, [catalog(), orders()], [releaseFile("1.1.0")]);

  it("appends the markers and list after the brief, leaving the brief alone", async () => {
    const { root, written } = project(brief, build);
    const result = await writeRelease(root, written, "1.1.0");
    const text = readFileSync(path.join(root, "grimoire/releases/1.1.0.md"), "utf8");

    expect(result.changed).toBe(true);
    expect(result.file).toBe("grimoire/releases/1.1.0.md");
    expect(text.startsWith(brief.trimEnd())).toBe(true);
    expect(text).toContain("### catalog");
    expect(text.endsWith(`${COLLECTED_END_MARKER}\n`)).toBe(true);
  });

  it("is idempotent: a second run changes nothing, byte for byte", async () => {
    const { root, written } = project(brief, build);

    await writeRelease(root, written, "1.1.0");

    const first = readFileSync(path.join(root, "grimoire/releases/1.1.0.md"));
    const second = await writeRelease(root, written, "1.1.0");

    expect(second.changed).toBe(false);
    expect(readFileSync(path.join(root, "grimoire/releases/1.1.0.md")).equals(first)).toBe(true);
    expect(first.toString().split("### catalog").length).toBe(2);
  });

  it("replaces a stale list and keeps the text around the markers", async () => {
    const stale = `${brief}\n${COLLECTED_START_MARKER}\nold\n${COLLECTED_END_MARKER}\n\nAfter the list.\n`;
    const { root, written } = project(stale, build);

    await writeRelease(root, written, "1.1.0");

    const text = readFileSync(path.join(root, "grimoire/releases/1.1.0.md"), "utf8");

    expect(text).not.toContain("old");
    expect(text.startsWith(brief)).toBe(true);
    expect(text.endsWith("\n\nAfter the list.\n")).toBe(true);
  });

  it("never touches a feature changelog or any other file", async () => {
    const { root, written } = project(brief, build);
    const changelog = path.join(root, "grimoire/features/catalog/CHANGELOG.md");
    const before = readFileSync(changelog);

    const result = await writeRelease(root, written, "1.1.0");

    expect(readFileSync(changelog).equals(before)).toBe(true);
    expect(result.unreleased.map((item) => item.text)).toEqual(["still being built"]);
    expect(result.collection.entries.some((item) => item.state === "unreleased")).toBe(false);
  });

  it("keeps CRLF line endings", async () => {
    const { root, written } = project(brief.replace(/\n/g, "\r\n"), build);

    await writeRelease(root, written, "1.1.0");

    expect(readFileSync(path.join(root, "grimoire/releases/1.1.0.md"), "utf8")).not.toMatch(
      /[^\r]\n/,
    );
  });

  it("refuses when the release file does not exist", async () => {
    const { root } = project(brief, build);

    await expect(writeRelease(root, grimoire(root, [], []), "1.1.0")).rejects.toThrow(
      /GR9005|does not exist/,
    );
  });

  it("refuses broken markers (GR1024)", async () => {
    const { root, written } = project(`${brief}\n${COLLECTED_START_MARKER}\n`, build);

    await expect(writeRelease(root, written, "1.1.0")).rejects.toThrow(
      /broken collected-list markers/,
    );
  });
});

describe("checkReleases", () => {
  const snapshotOf = (written: WrittenGrimoire) =>
    ({ written, root: written.root }) as unknown as GrimoireSnapshot;
  const listed = (version: string, text: string, flow: string | null = null) => ({
    feature: "catalog",
    version,
    word: "fixed" as ChangeWord,
    flow,
    criteria: [],
    text,
    at: at("grimoire/releases/1.1.0.md", 12),
  });
  const withList = (entries: ReturnType<typeof listed>[]) =>
    releaseFile("1.1.0", "Brief.", { start: at("r.md", 8), end: at("r.md", 20), entries });
  const older = releaseFile("1.0.0");

  it("passes when every listed entry is stamped", () => {
    const written = grimoire(
      "/p",
      [catalog()],
      [
        older,
        withList([listed("2.1", "a customer with no country saw an empty list", "new-arrivals")]),
      ],
    );

    expect(checkReleases(snapshotOf(written))).toEqual([]);
  });

  it("GR6001: a listed entry still under Unreleased", () => {
    const written = grimoire(
      "/p",
      [feature("catalog", [entry("catalog", "2.2", "fixed", "still being built", null)])],
      [withList([listed("2.2", "still being built")])],
    );
    const found = checkReleases(snapshotOf(written));

    expect(found.map((item) => item.code)).toEqual(["GR6001"]);
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.subject.feature).toBe("catalog");
  });

  it("GR6001: a listed entry that exists in no changelog", () => {
    const written = grimoire("/p", [catalog()], [older, withList([listed("9.9", "ghost")])]);

    expect(checkReleases(snapshotOf(written)).map((item) => item.code)).toEqual(["GR6001"]);
  });

  it("GR6002: a changelog release section with no release file", () => {
    const found = checkReleases(snapshotOf(grimoire("/p", [orders()], [])));

    expect(found.map((item) => item.code)).toEqual(["GR6002"]);
    expect(found[0]?.message).toContain("grimoire/releases/1.1.0.md");
  });

  it("GR6003: a changelog date that differs from the release file", () => {
    const file = releaseFile("1.1.0");
    const found = checkReleases(
      snapshotOf(grimoire("/p", [orders()], [{ ...file, date: located("2026-11-21") }])),
    );

    expect(found.map((item) => item.code)).toEqual(["GR6003"]);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { releaseNotesCommand } from "../cli/commands/release-notes.command";
import { releaseNotesPointer } from "./release-notes";
import {
  extractBreaking,
  installedCoreVersion,
  listReleaseVersions,
  parseReleaseNote,
  readReleaseNote,
  readReleaseRange,
  releasesDirectory,
} from "./release-notes";
import { runReleaseNotesCommand } from "./release-notes-command.action";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function summary(version: string, date: string, breaking: string): string {
  return `# Warlock.js ${version} — release summary\n\nReleased ${date}.\n\n## 1. Breaking changes\n\n${breaking}\n\n## 2. Added\n\n- A feature.\n`;
}

/** A package folder with a `releases/` directory; returns the directory. */
function packageWith(files: Record<string, string>, version = "5.38.0"): string {
  const root = mkdtempSync(path.join(tmpdir(), "release-notes-"));
  roots.push(root);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@warlock.js/core", version }),
  );
  const directory = path.join(root, "releases");
  mkdirSync(directory);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(directory, name), text);
  return directory;
}

const FILES = {
  "5.36.0-summary.md": summary(
    "5.36.0",
    "2026-10-22",
    "- **Vite 7 is dropped.** Install Vite 8\n  with the plugin.\n- **Pages embed named routes only.** Declare them.",
  ),
  "5.37.0-summary.md": summary(
    "5.37.0",
    "2026-10-24",
    "- **Rollbacks ask first.** Pass `--yes` in CI.",
  ),
  "5.37.1-summary.md":
    "# Warlock.js 5.37.1 — release summary\n\nReleased 2026-10-24.\n\n## 1. Fixes\n\n- Fixed a thing.\n",
  "5.38.0-summary.md": summary(
    "5.38.0",
    "2026-10-25",
    "- **Typed model reads reject unknown columns.** Add the column.\n- **Nothing else in 5.38.0 is marked breaking.** Review the rest.",
  ),
};

function run(options: Record<string, string | boolean>, directory: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runReleaseNotesCommand(
    options,
    { directory },
    {
      log: (message) => out.push(message),
      error: (message) => err.push(message),
    },
  );
  process.exitCode = undefined;
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("extractBreaking", () => {
  it("returns the bold titles of the breaking section, skipping the 'nothing else' note", () => {
    expect(extractBreaking(FILES["5.38.0-summary.md"])).toEqual([
      "Typed model reads reject unknown columns",
    ]);
    expect(extractBreaking(FILES["5.36.0-summary.md"])).toEqual([
      "Vite 7 is dropped",
      "Pages embed named routes only",
    ]);
  });

  it("returns an empty list when a release has no breaking section", () => {
    expect(extractBreaking(FILES["5.37.1-summary.md"])).toEqual([]);
  });

  it("falls back to the subsection headings when no item is bold", () => {
    const markdown =
      "## 2. Breaking changes\n\n### Install the family together\n\n1. Update every package.\n\n## 3. Added\n";
    expect(extractBreaking(markdown)).toEqual(["Install the family together"]);
  });

  it("ignores list items inside code fences", () => {
    const markdown =
      "## 1. Breaking changes\n\n```bash\n- **not an item**\n```\n\n- **Real one.** Text.\n";
    expect(extractBreaking(markdown)).toEqual(["Real one"]);
  });
});

describe("reading summaries", () => {
  it("parses the date and lists versions oldest first", () => {
    const directory = packageWith(FILES);
    expect(parseReleaseNote("5.37.0", FILES["5.37.0-summary.md"]).date).toBe("2026-10-24");
    expect(listReleaseVersions(directory)).toEqual(["5.36.0", "5.37.0", "5.37.1", "5.38.0"]);
    expect(readReleaseNote("5.37", directory)?.version).toBe("5.37.0");
    expect(readReleaseNote("5.99.0", directory)).toBeUndefined();
    expect(installedCoreVersion(directory)).toBe("5.38.0");
  });

  it("returns the releases after `from` up to `to`", () => {
    const directory = packageWith(FILES);
    expect(readReleaseRange("5.36", undefined, directory).map((n) => n.version)).toEqual([
      "5.37.0",
      "5.37.1",
      "5.38.0",
    ]);
    expect(readReleaseRange("5.36.0", "5.37.0", directory).map((n) => n.version)).toEqual([
      "5.37.0",
    ]);
  });

  it("finds the shipped summaries of this package", () => {
    expect(listReleaseVersions(releasesDirectory())).toContain("5.38.0");
  });
});

describe("warlock release-notes", () => {
  it("prints the installed version's summary by default", () => {
    const directory = packageWith(FILES);
    const { code, out } = run({}, directory);
    expect(code).toBe(0);
    expect(out).toContain("# Warlock.js 5.38.0 — release summary");
  });

  it("prints a range oldest first, led by the combined breaking list", () => {
    const directory = packageWith(FILES);
    const { code, out } = run({ from: "5.36" }, directory);
    expect(code).toBe(0);
    expect(out.startsWith("# Breaking changes after 5.36.0")).toBe(true);
    expect(out).toContain("- 5.37.0: Rollbacks ask first");
    expect(out).toContain("- 5.38.0: Typed model reads reject unknown columns");
    expect(out).not.toContain("- 5.36.0:");
    expect(out.indexOf("Warlock.js 5.37.0")).toBeLessThan(out.indexOf("Warlock.js 5.38.0"));
  });

  it("prints one version and lists versions with dates", () => {
    const directory = packageWith(FILES);
    expect(run({ version: "5.36.0" }, directory).out).toContain("Warlock.js 5.36.0");
    expect(run({ list: true }, directory).out).toBe(
      "5.36.0  2026-10-22\n5.37.0  2026-10-24\n5.37.1  2026-10-24\n5.38.0  2026-10-25",
    );
  });

  it("prints { versions } as JSON", () => {
    const directory = packageWith(FILES);
    const { out } = run({ from: "5.37", json: true }, directory);
    const data = JSON.parse(out) as { versions: Array<Record<string, unknown>> };
    expect(data.versions.map((v) => v.version)).toEqual(["5.37.1", "5.38.0"]);
    expect(data.versions[1]).toMatchObject({
      version: "5.38.0",
      date: "2026-10-25",
      breaking: ["Typed model reads reject unknown columns"],
    });
    expect(String(data.versions[1]!.markdown)).toContain("release summary");
  });

  it("points at the GitHub release for a missing version and exits 1", () => {
    const directory = packageWith(FILES);
    const { code, err } = run({ version: "5.99.0" }, directory);
    expect(code).toBe(1);
    expect(err).toContain("https://github.com/warlockjs/framework/releases/tag/v5.99.0");
  });

  it("reports a missing installed-version summary as an error", () => {
    const directory = packageWith({ "5.36.0-summary.md": FILES["5.36.0-summary.md"] }, "5.40.0");
    const { code, err } = run({}, directory);
    expect(code).toBe(1);
    expect(err).toContain("v5.40.0");
  });

  it("rejects --to without --from and a malformed version", () => {
    const directory = packageWith(FILES);
    expect(run({ to: "5.37" }, directory).code).toBe(1);
    expect(run({ from: "latest" }, directory).code).toBe(1);
  });

  it("is registered with its options", () => {
    expect(releaseNotesCommand.name).toBe("release-notes");
    expect(releaseNotesCommand.commandOptions.map((option) => option.name)).toEqual(
      expect.arrayContaining(["from", "to", "version", "list", "json"]),
    );
  });

  it("builds the upgrade pointer line", () => {
    expect(releaseNotesPointer("^5.36.2")).toBe(
      "What's new: npx warlock release-notes --from 5.36.2",
    );
  });
});

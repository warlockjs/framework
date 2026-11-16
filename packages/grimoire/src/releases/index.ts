/**
 * Releases: collecting the changelog entries the agent stamped with a release
 * into `grimoire/releases/<release>.md`, and the GR6001–GR6003 rules.
 *
 * Warlock never edits a feature changelog or the agent's brief. It writes only
 * the text between the collected-list markers of the release file.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GrimoireError, createFinding } from "../codes";
import type { GrimoireFinding } from "../contracts/findings";
import type { ReleaseCollection, ReleaseEntry, WriteReleaseResult } from "../contracts/releases";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import {
  COLLECTED_END_MARKER,
  COLLECTED_START_MARKER,
  type WrittenChangelogEntry,
  type WrittenGrimoire,
  type WrittenRelease,
} from "../contracts/written";
import { releaseFilePath } from "../paths";

/** What `writeRelease()` returns: the contract result plus the entries it left out. */
export type WriteReleaseOutcome = WriteReleaseResult & {
  /** Entries still under `## Unreleased`; not collected. */
  unreleased: ReleaseEntry[];
};

function findRelease(written: WrittenGrimoire, release: string): WrittenRelease | undefined {
  return written.releases.find((item) => item.release.value === release);
}

function toReleaseEntry(entry: WrittenChangelogEntry, state: ReleaseEntry["state"]): ReleaseEntry {
  return {
    feature: entry.feature,
    version: entry.version.value,
    word: entry.word,
    flow: entry.flow,
    criteria: [...entry.criteria],
    text: entry.text,
    state,
    source: entry.at,
  };
}

/** Compare two `<whole>.<decimal>` versions, newest first. */
function compareVersionsDescending(a: string, b: string): number {
  const [aWhole = 0, aDecimal = 0] = a.split(".").map(Number);
  const [bWhole = 0, bDecimal = 0] = b.split(".").map(Number);

  return bWhole - aWhole || bDecimal - aDecimal;
}

function sortEntries(entries: ReleaseEntry[]): ReleaseEntry[] {
  // `sort` is stable, so equal versions keep their changelog order.
  return entries.sort(
    (a, b) => a.feature.localeCompare(b.feature) || compareVersionsDescending(a.version, b.version),
  );
}

/**
 * The entries still under `## Unreleased` in every feature changelog. They are
 * not part of any release until the agent stamps them.
 */
export function unreleasedEntries(written: WrittenGrimoire): ReleaseEntry[] {
  const entries: ReleaseEntry[] = [];

  for (const feature of written.features) {
    for (const entry of feature.changelog?.entries ?? []) {
      if (entry.release === null) entries.push(toReleaseEntry(entry, "unreleased"));
    }
  }

  return sortEntries(entries);
}

/**
 * The entries a release lists: the entries the agent stamped with that release
 * (under `## <release> (<date>)`). Entries under `## Unreleased` are never
 * collected. Throws a `GrimoireError` with `GR9005` when
 * `grimoire/releases/<release>.md` does not exist, has no `release` and
 * `date`, or has no brief.
 */
export function collectRelease(written: WrittenGrimoire, release: string): ReleaseCollection {
  const file = findRelease(written, release);

  if (!file || file.release.value === "" || file.date.value === "") {
    throw new GrimoireError(
      "GR9005",
      `${releaseFilePath(release)} does not exist or has no release and date. Write the brief first, with \`release\` and \`date\` in the front matter.`,
    );
  }

  if (file.brief.trim() === "") {
    throw new GrimoireError(
      "GR9005",
      `${file.file} has no brief yet. Write the brief under the heading, then run the command again.`,
    );
  }

  const entries: ReleaseEntry[] = [];

  for (const feature of written.features) {
    for (const entry of feature.changelog?.entries ?? []) {
      if (entry.release === release) entries.push(toReleaseEntry(entry, "stamped"));
    }
  }

  return { release, date: file.date.value, entries: sortEntries(entries) };
}

function entryLine(entry: {
  version: string;
  word: string;
  flow: string | null;
  criteria: string[];
  text: string;
}): string {
  const flow = entry.flow === null ? "" : `${entry.flow}: `;
  const criteria = entry.criteria.length > 0 ? ` (${entry.criteria.join(", ")})` : "";

  return `- ${entry.version}  ${entry.word}  ${flow}${entry.text}${criteria}`;
}

/** The Markdown between (and including) the collected-list markers. Pure. */
export function renderCollectedList(collection: ReleaseCollection): string {
  const lines: string[] = [COLLECTED_START_MARKER];

  if (collection.entries.length === 0) {
    lines.push("No feature changes.");
  } else {
    lines.push("## Changes");

    let current: string | null = null;

    for (const entry of collection.entries) {
      if (entry.feature !== current) {
        current = entry.feature;
        lines.push("", `### ${entry.feature}`);
      }

      lines.push(entryLine(entry));
    }
  }

  lines.push(COLLECTED_END_MARKER);

  return lines.join("\n");
}

/**
 * Collect the release and write the list into its file: replaces the text
 * between the markers, or appends the markers and the list at the end. Never
 * touches any other file or any text outside the markers. Refuses (`GR9005`)
 * when the agent has not written the release file and its brief.
 *
 * @param root Absolute project root.
 */
export async function writeRelease(
  root: string,
  written: WrittenGrimoire,
  release: string,
): Promise<WriteReleaseOutcome> {
  const collection = collectRelease(written, release);
  const file = findRelease(written, release)?.file ?? releaseFilePath(release);
  const absolute = path.join(root, ...file.split("/"));
  const current = await readFile(absolute, "utf8");
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const list = renderCollectedList(collection).split("\n").join(eol);
  const start = current.indexOf(COLLECTED_START_MARKER);
  const end = current.indexOf(COLLECTED_END_MARKER);

  let next: string;

  if (start === -1 && end === -1) {
    const base = current.replace(/\s+$/, "");

    next = `${base}${eol}${eol}${list}${eol}`;
  } else if (
    start === -1 ||
    end === -1 ||
    end < start ||
    current.indexOf(COLLECTED_START_MARKER, start + 1) !== -1 ||
    current.indexOf(COLLECTED_END_MARKER, end + 1) !== -1
  ) {
    throw new GrimoireError(
      "GR1024",
      `${file} has broken collected-list markers. Keep one start marker followed by one end marker, or remove both.`,
    );
  } else {
    next = current.slice(0, start) + list + current.slice(end + COLLECTED_END_MARKER.length);
  }

  const changed = next !== current;

  if (changed) await writeFile(absolute, next);

  return { file, collection, changed, unreleased: unreleasedEntries(written) };
}

function sameEntry(
  listed: { feature: string; version: string; word: string; flow: string | null; text: string },
  entry: WrittenChangelogEntry,
): boolean {
  return (
    listed.feature === entry.feature &&
    listed.version === entry.version.value &&
    listed.word === entry.word &&
    listed.flow === entry.flow &&
    listed.text === entry.text
  );
}

/** The GR6001–GR6003 rules. Read-only. */
export function checkReleases(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const { written } = snapshot;
  const findings: GrimoireFinding[] = [];

  // GR6001: a listed entry with no matching entry stamped with this release.
  for (const file of written.releases) {
    for (const listed of file.collected?.entries ?? []) {
      const changelog = written.features.find(
        (feature) => feature.id === listed.feature,
      )?.changelog;
      const stamped = (changelog?.entries ?? []).some(
        (entry) =>
          entry.release === file.release.value && entry.date !== null && sameEntry(listed, entry),
      );

      if (!stamped) {
        findings.push(
          createFinding({
            code: "GR6001",
            message: `release ${file.release.value} lists "${listed.feature} ${listed.version} ${listed.word}: ${listed.text}", but no entry in that changelog is stamped with ${file.release.value} and a date`,
            at: listed.at,
            feature: listed.feature,
            file: file.file,
          }),
        );
      }
    }
  }

  // GR6002 and GR6003: a changelog release section needs its release file and date.
  for (const feature of written.features) {
    for (const section of feature.changelog?.sections ?? []) {
      if (section.release === null) continue;

      const file = findRelease(written, section.release);

      if (!file) {
        findings.push(
          createFinding({
            code: "GR6002",
            message: `${feature.id} changelog has a section for release ${section.release}, but ${releaseFilePath(section.release)} does not exist`,
            at: section.at,
            feature: feature.id,
            file: section.at.file,
          }),
        );
      } else if (section.date !== null && section.date !== file.date.value) {
        findings.push(
          createFinding({
            code: "GR6003",
            message: `${feature.id} changelog dates release ${section.release} ${section.date}, but ${file.file} says ${file.date.value}`,
            at: section.at,
            feature: feature.id,
            file: section.at.file,
          }),
        );
      }
    }
  }

  return findings;
}

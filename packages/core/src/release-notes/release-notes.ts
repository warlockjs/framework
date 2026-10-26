import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, normalizeVersion, parseVersion } from "../upgrade/version";

/** One family release summary shipped in `@warlock.js/core` (`releases/<version>-summary.md`). */
export type ReleaseNote = {
  version: string;
  /** The `Released YYYY-MM-DD` date, or `null` when the file has none. */
  date: string | null;
  /** One line per breaking change in the summary's breaking-changes section. */
  breaking: string[];
  /** The full summary, unchanged. */
  markdown: string;
};

const SUMMARY_FILE = /^(\d+\.\d+\.\d+)-summary\.md$/;

/** GitHub release page of a version, where a summary missing from the package can be read. */
export function releaseUrl(version: string): string {
  return `https://github.com/warlockjs/framework/releases/tag/v${version}`;
}

/**
 * The folder holding the shipped summaries: `releases/` in the package that
 * contains this module (found by walking up to its `package.json`), so it works
 * from source, from the build and from `node_modules`.
 */
export function releasesDirectory(from: string = path.dirname(fileURLToPath(import.meta.url))) {
  let directory = from;

  for (let depth = 0; depth < 8; depth++) {
    if (existsSync(path.join(directory, "package.json"))) {
      return path.join(directory, "releases");
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return path.join(from, "releases");
}

/** The version of the `@warlock.js/core` package that contains `directory`'s `releases/` folder. */
export function installedCoreVersion(directory: string = releasesDirectory()): string | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(path.dirname(directory), "package.json"), "utf8"),
    ) as { version?: unknown };

    return typeof manifest.version === "string" ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

/** Collapse a markdown fragment to one plain line. */
function plain(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
}

/** The title of a list item: its bold lead, or its first sentence. */
function itemTitle(item: string): string {
  const bold = /^\*\*(.+?)\*\*/s.exec(item);
  const text = plain(bold ? bold[1]! : item);
  const sentence = bold ? text : (/^(.+?[.!?])(?:\s|$)/.exec(text)?.[1] ?? text);

  return sentence.replace(/[.:]$/, "").trim();
}

/**
 * The breaking changes a summary lists, one line each. Reads the first `##`
 * section whose heading says "breaking": its bold-led list items, else its `###`
 * headings, else its first paragraph. Empty when the release has none.
 */
export function extractBreaking(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s/.test(line) && /breaking/i.test(line));

  if (start === -1) return [];

  let end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  if (end === -1) end = lines.length;

  const body = lines.slice(start + 1, end);
  const items: string[][] = [];
  let current: string[] | undefined;
  let fenced = false;

  for (const line of body) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;

    if (/^(?:[-*]|\d+\.)\s+\S/.test(line)) {
      current = [line.replace(/^(?:[-*]|\d+\.)\s+/, "")];
      items.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.push(line.trim());
    } else if (!line.trim()) {
      current = undefined;
    }
  }

  const bolded = items
    .map((parts) => parts.join(" "))
    .filter((item) => item.startsWith("**"))
    .map(itemTitle)
    .filter((title) => title && !/^nothing\b/i.test(title));

  if (bolded.length > 0) return bolded;

  const headings = body
    .filter((line) => /^###\s/.test(line))
    .map((line) => plain(line.replace(/^###\s+/, "")));

  if (headings.length > 0) return headings;

  const paragraph = body
    .join("\n")
    .split(/\n\s*\n/)
    .map(plain)
    .find(Boolean);

  return paragraph ? [itemTitle(paragraph)] : [];
}

/** Parse one summary file's text. */
export function parseReleaseNote(version: string, markdown: string): ReleaseNote {
  return {
    version,
    date: /^Released (\d{4}-\d{2}-\d{2})/m.exec(markdown)?.[1] ?? null,
    breaking: extractBreaking(markdown),
    markdown,
  };
}

/** Versions that have a shipped summary, oldest first. */
export function listReleaseVersions(directory: string = releasesDirectory()): string[] {
  try {
    return readdirSync(directory)
      .map((name) => SUMMARY_FILE.exec(name)?.[1])
      .filter((version): version is string => Boolean(version))
      .sort(compareVersions);
  } catch {
    return [];
  }
}

/** One version's summary, or `undefined` when the package does not ship it. */
export function readReleaseNote(
  version: string,
  directory: string = releasesDirectory(),
): ReleaseNote | undefined {
  const file = path.join(directory, `${normalizeVersion(version)}-summary.md`);

  if (!existsSync(file)) return undefined;

  return parseReleaseNote(normalizeVersion(version), readFileSync(file, "utf8"));
}

/**
 * Every shipped summary after `from` up to and including `to` (default: the
 * newest shipped), oldest first. The `from` release itself is not included:
 * an app on it already has those changes.
 */
export function readReleaseRange(
  from: string,
  to?: string,
  directory: string = releasesDirectory(),
): ReleaseNote[] {
  const lower = normalizeVersion(from);
  const upper = to === undefined ? undefined : normalizeVersion(to);

  return listReleaseVersions(directory)
    .filter(
      (version) =>
        compareVersions(version, lower) > 0 &&
        (upper === undefined || compareVersions(version, upper) <= 0),
    )
    .map((version) => readReleaseNote(version, directory)!);
}

/** The one-line pointer commands print after an upgrade. */
export function releaseNotesPointer(from: string): string {
  const version = parseVersion(from);

  return `What's new: npx warlock release-notes --from ${version ? version.join(".") : from}`;
}

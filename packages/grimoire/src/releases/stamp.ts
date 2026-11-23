/**
 * Release stamping (`warlock grimoire release --stamp`): moves the entries under
 * `## Unreleased` of each feature changelog under `## <version> (<date>)` and
 * writes the release file when it is missing. It is the one edit Warlock makes to
 * written files, and only on request.
 *
 * `planStamp()` is pure (text in, text out). `applyStamp()` is the thin writer.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GrimoireError } from "../codes";
import type { WrittenGrimoire } from "../contracts/written";
import { releaseFilePath } from "../paths";
import { isDate } from "../written/fields";

const UNRELEASED = /^##[ \t]+unreleased[ \t]*$/i;
/** A section heading of a feature changelog: level 2 only (`### Added` stays inside its section). */
const HEADING = /^##[ \t]/;
/** A release section heading, the way the changelog parser reads it. */
const RELEASE_HEADING = /^##[ \t]+(\S+)[ \t]+\((.+)\)$/;

export type StampInput = {
  /** The release name, such as `1.4.0`. */
  version: string;
  /** `yyyy-mm-dd`. */
  date: string;
  written: WrittenGrimoire;
  /** The text of each feature changelog by project-relative path (at least the ones with unreleased entries). */
  texts: Readonly<Record<string, string>>;
};

export type StampPlan = {
  version: string;
  date: string;
  /** Changelogs that change, with their new text. */
  changelogs: { feature: string; file: string; text: string }[];
  /** The release file to create, or `null` when it exists. */
  release: { file: string; text: string } | null;
};

function refuse(message: string): never {
  throw new GrimoireError("GR9006", message);
}

/** "a", "a and b", "a, b and c". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The new text of one changelog: the `## Unreleased` heading line stays as the
 * (now empty) unreleased section, and `## <version> (<date>)` and a blank line
 * follow it. When the changelog already has a section for the version (same date),
 * the unreleased lines move to the top of that section instead.
 */
function stampText(
  text: string,
  file: string,
  version: string,
  date: string,
  hasSection: boolean,
): string {
  const lines = text.split("\n");
  const cr = (line: string): string => (line.endsWith("\r") ? "\r" : "");
  const start = lines.findIndex((line) => UNRELEASED.test(line.trimEnd()));

  if (start === -1) refuse(`${file} has no "## Unreleased" heading to stamp.`);

  const heading = `## ${version} (${date})`;

  if (!hasSection) {
    const fresh = lines[start] ?? "";

    lines.splice(start, 1, fresh, cr(fresh), `${heading}${cr(fresh)}`);

    return lines.join("\n");
  }

  // The version already has a section: move the unreleased lines to the top of it.
  let end = start + 1;

  while (end < lines.length && !HEADING.test(lines[end] ?? "")) end++;

  const body = lines.slice(start + 1, end);

  while (body.length > 0 && (body[body.length - 1] ?? "").trim() === "") body.pop();
  while (body.length > 0 && (body[0] ?? "").trim() === "") body.shift();

  const out = [...lines.slice(0, start + 1), cr(lines[start] ?? ""), ...lines.slice(end)];
  const at = out.findIndex((line) => {
    const match = RELEASE_HEADING.exec(line.trimEnd());

    return match !== null && match[1] === version && match[2]?.trim() === date;
  });

  if (at === -1) refuse(`${file} has no "${heading}" heading to stamp.`);

  out.splice(at + 1, 0, ...body);

  return out.join("\n");
}

/** Plan a stamp: the new changelog texts and the release file to create. Pure. */
export function planStamp(input: StampInput): StampPlan {
  const { version, date, written, texts } = input;

  if (!isDate(date)) refuse(`The release date must be yyyy-mm-dd (got ${JSON.stringify(date)}).`);

  const changelogs: StampPlan["changelogs"] = [];
  const titles: string[] = [];

  for (const feature of written.features) {
    const changelog = feature.changelog;

    if (changelog === null || !changelog.entries.some((entry) => entry.release === null)) continue;

    const same = changelog.sections.find((section) => section.release === version);

    if (same !== undefined && same.date !== date) {
      refuse(
        `${changelog.file} already has a section for ${version} dated ${same.date ?? ""}, not ${date}. Use that date, or correct the heading.`,
      );
    }

    const text = texts[changelog.file];

    if (text === undefined) refuse(`The text of ${changelog.file} was not given.`);

    changelogs.push({
      feature: feature.id,
      file: changelog.file,
      text: stampText(text, changelog.file, version, date, same !== undefined),
    });
    titles.push(feature.readme?.title.value ?? feature.id);
  }

  const file = releaseFilePath(version);
  const exists = written.releases.some((item) => item.release.value === version);
  const brief =
    titles.length === 0 ? "No feature changes in this release." : `Changes to ${listOf(titles)}.`;

  return {
    version,
    date,
    changelogs,
    release: exists
      ? null
      : {
          file,
          text: `---\nrelease: ${version}\ndate: ${date}\n---\n\n# Release ${version}\n\n${brief}\n`,
        },
  };
}

/** Read the changelogs, plan the stamp and write it. Returns the plan. */
export async function applyStamp(
  root: string,
  written: WrittenGrimoire,
  version: string,
  date: string,
): Promise<StampPlan> {
  const texts: Record<string, string> = {};

  for (const feature of written.features) {
    const file = feature.changelog?.file;

    if (file !== undefined) {
      texts[file] = await readFile(path.join(root, ...file.split("/")), "utf8");
    }
  }

  const plan = planStamp({ version, date, written, texts });

  for (const item of plan.changelogs) {
    await writeFile(path.join(root, ...item.file.split("/")), item.text);
  }

  if (plan.release !== null) {
    const absolute = path.join(root, ...plan.release.file.split("/"));

    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, plan.release.text);
  }

  return plan;
}

/**
 * List sections: `- name   text` lines (a `-` or `*` bullet, the name,
 * spaces or a tab, the text), with indented continuation lines. Lines that
 * are not bullets are free text and are skipped.
 *
 * Two or more spaces line the texts up, but one space is read too: a
 * Markdown formatter collapses the spaces of a list line to one.
 */
import type { WrittenListLine } from "../contracts/written";
import { SEP } from "./fields";
import { lineAt, logicalLines, type BodyLine, type LogicalLine } from "./markdown";
import type { FindingSink } from "./sink";

/** A `-` or `*` bullet. */
export const BULLET = /^[-*][ \t]+/;
const LIST_LINE = new RegExp(String.raw`^[-*][ \t]+(\S.*?)${SEP}(\S.*)$`);
const TOKEN_LINE = /^[-*][ \t]+(\S+)[ \t]+(\S.*)$/;

/** Names of several words that a list line may start with (the case questions). */
export type ListNames = readonly string[];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The bullet lines of a section, continuation lines joined. */
export function bulletLines(lines: readonly BodyLine[]): LogicalLine[] {
  return logicalLines(lines).filter((line) => BULLET.test(line.text));
}

/**
 * Split one `- name   text` line, or `null` when it does not have that form.
 * Two or more spaces (or a tab) end the name. Without them, a known name
 * (in any case, with any spaces between its words) is tried, and then the
 * name is the first word.
 */
export function splitListLine(
  text: string,
  known: ListNames = [],
): { name: string; text: string } | null {
  const separated = LIST_LINE.exec(text);

  if (separated) return { name: (separated[1] ?? "").trim(), text: (separated[2] ?? "").trim() };

  const rest = text.replace(BULLET, "").trim().replace(/\s+/g, " ").toLowerCase();

  // A known name alone (`- invalid input`) has no text.
  if (known.some((name) => name.toLowerCase() === rest)) return null;

  for (const name of [...known].sort((left, right) => right.length - left.length)) {
    const words = name.trim().split(/\s+/).map(escapeRegExp).join("[ \\t]+");
    const match = new RegExp(String.raw`^[-*][ \t]+(${words})[ \t]+(\S.*)$`, "i").exec(text);

    if (match) return { name: (match[1] ?? "").trim(), text: (match[2] ?? "").trim() };
  }

  const match = TOKEN_LINE.exec(text);

  if (!match) return null;

  return { name: (match[1] ?? "").trim(), text: (match[2] ?? "").trim() };
}

/**
 * Read a list section. A bullet with a name and no text is reported with
 * GR1028 and left out.
 */
export function readListLines(
  file: string,
  lines: readonly BodyLine[] | undefined,
  what: string,
  sink: FindingSink,
  known: ListNames = [],
): WrittenListLine[] {
  const result: WrittenListLine[] = [];

  for (const line of bulletLines(lines ?? [])) {
    const split = splitListLine(line.text, known);

    if (split === null) {
      sink.report(
        "GR1028",
        `the ${what} line ${JSON.stringify(line.text)} is not \`- name   text\` (the name, spaces, then the text).`,
        lineAt(file, line.line),
      );
      continue;
    }

    result.push({ name: split.name, text: split.text, at: lineAt(file, line.line) });
  }

  return result;
}

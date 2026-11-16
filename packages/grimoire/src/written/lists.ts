/**
 * List sections: `- name   text` lines (a `-` or `*` bullet, the name, two
 * or more spaces or a tab, the text), with indented continuation lines.
 * Lines that are not bullets are free text and are skipped.
 */
import type { WrittenListLine } from "../contracts/written";
import { SEP } from "./fields";
import { lineAt, logicalLines, type BodyLine, type LogicalLine } from "./markdown";
import type { FindingSink } from "./sink";

/** A `-` or `*` bullet. */
export const BULLET = /^[-*][ \t]+/;
const LIST_LINE = new RegExp(String.raw`^[-*][ \t]+(\S.*?)${SEP}(\S.*)$`);

/** The bullet lines of a section, continuation lines joined. */
export function bulletLines(lines: readonly BodyLine[]): LogicalLine[] {
  return logicalLines(lines).filter((line) => BULLET.test(line.text));
}

/** Split one `- name   text` line, or `null` when it does not have that form. */
export function splitListLine(text: string): { name: string; text: string } | null {
  const match = LIST_LINE.exec(text);

  if (!match) return null;

  return { name: (match[1] ?? "").trim(), text: (match[2] ?? "").trim() };
}

/**
 * Read a list section. A bullet without the two-space separator is reported
 * with `code` (GR1028 by default) and left out.
 */
export function readListLines(
  file: string,
  lines: readonly BodyLine[] | undefined,
  what: string,
  sink: FindingSink,
  code = "GR1028",
): WrittenListLine[] {
  const result: WrittenListLine[] = [];

  for (const line of bulletLines(lines ?? [])) {
    const split = splitListLine(line.text);

    if (split === null) {
      sink.report(
        code,
        `The ${what} line ${JSON.stringify(line.text)} is not \`- name   text\` (the name, two or more spaces, then the text).`,
        lineAt(file, line.line),
      );
      continue;
    }

    result.push({ name: split.name, text: split.text, at: lineAt(file, line.line) });
  }

  return result;
}

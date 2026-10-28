import { WorkspaceEditError } from "../errors";
import type { PatchHunk } from "./parse-patch";

/** The text of a line without a trailing carriage return. */
const bare = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);

/** Same, and ignoring trailing blanks (a second, looser matching pass). */
const loose = (line: string): string => bare(line).trimEnd();

/** Split file content into lines (carriage returns kept) and note the final newline. */
function split(content: string): { lines: string[]; trailingNewline: boolean } {
  if (content === "") {
    return { lines: [], trailingNewline: false };
  }

  const parts = content.split("\n");
  const trailingNewline = parts[parts.length - 1] === "";

  if (trailingNewline) {
    parts.pop();
  }

  return { lines: parts, trailingNewline };
}

/** Whether most of the file's lines end in CRLF. */
function usesCrlf(lines: string[]): boolean {
  const crlf = lines.filter((line) => line.endsWith("\r")).length;

  return crlf > 0 && crlf * 2 >= lines.length;
}

/** First index at or after `from` (searching outward from `expected`) where `old` matches. */
function findMatch(
  lines: string[],
  old: string[],
  expected: number,
  from: number,
  normalize: (line: string) => string,
): number {
  if (old.length === 0) {
    return Math.min(Math.max(expected, from), lines.length);
  }

  const last = lines.length - old.length;
  const wanted = old.map(normalize);
  const matches = (start: number): boolean =>
    start >= from &&
    start <= last &&
    wanted.every((line, offset) => normalize(lines[start + offset] as string) === line);

  for (let distance = 0; distance <= lines.length; distance++) {
    if (matches(expected + distance)) {
      return expected + distance;
    }

    if (distance > 0 && matches(expected - distance)) {
      return expected - distance;
    }
  }

  return -1;
}

/**
 * Apply a file's hunks to its content, in memory. Hunks are located by their
 * context (not only by line number, so a few lines of drift are fine), must
 * not overlap, and keep the file's line endings: untouched lines are
 * byte-for-byte as they were and added lines use the file's CRLF/LF style.
 *
 * Throws a `WorkspaceEditError` (`hunk-failed`) naming the first hunk whose
 * context is not in the file; nothing is returned in that case.
 */
export function applyHunks(content: string, hunks: PatchHunk[], displayPath: string): string {
  const { lines, trailingNewline: initialTrailing } = split(content);
  const wasEmpty = lines.length === 0;
  const eol = usesCrlf(lines) ? "\r" : "";
  let trailingNewline = initialTrailing;
  let cursor = 0;
  let delta = 0;

  hunks.forEach((hunk, hunkIndex) => {
    const old = hunk.lines.filter((line) => line.op !== "+").map((line) => line.text);
    // For a hunk with no old lines `oldStart` is the line *after which* to insert.
    const expected = (old.length === 0 ? hunk.oldStart : hunk.oldStart - 1) + delta;
    let start = findMatch(lines, old, expected, cursor, bare);

    if (start === -1) {
      start = findMatch(lines, old, expected, cursor, loose);
    }

    if (start === -1) {
      const probe = old.find((line) => line.trim() !== "") ?? old[0] ?? "";

      throw new WorkspaceEditError(
        `Hunk ${hunkIndex + 1} of ${displayPath} does not apply: its context was not found in the file${probe === "" ? "" : ` (looked for a line like ${JSON.stringify(probe.slice(0, 80))})`}. Re-read the file and regenerate the patch.`,
        { type: "hunk-failed", path: displayPath, hunkIndex },
      );
    }

    const replacement: string[] = [];
    let consumed = start;

    for (const line of hunk.lines) {
      if (line.op === " ") {
        replacement.push(lines[consumed] as string);
        consumed++;
      } else if (line.op === "-") {
        consumed++;
      } else {
        replacement.push(line.text + eol);
      }
    }

    lines.splice(start, old.length, ...replacement);
    cursor = start + replacement.length;
    delta += replacement.length - old.length;

    if (cursor >= lines.length) {
      if (hunk.newNoNewline) {
        trailingNewline = false;
      } else if (hunk.oldNoNewline || wasEmpty) {
        trailingNewline = true;
      }
    }
  });

  if (lines.length === 0) {
    return "";
  }

  // A final line that kept its "\r" but now ends the file without a newline
  // is left alone; only the newline itself is toggled.
  return lines.join("\n") + (trailingNewline ? "\n" : "");
}

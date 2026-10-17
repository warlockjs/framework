import { WarlockError } from "../../errors/warlock-error";

/** The file `warlock agents-md --write` and `warlock dev` maintain, at the project root. */
export const AGENTS_MD_FILE = "AGENTS.md";

/** Opens the generated section. Everything outside the two markers is hand-written. */
export const AGENTS_MD_START = "<!-- warlock:generated:start -->";

/** Closes the generated section. */
export const AGENTS_MD_END = "<!-- warlock:generated:end -->";

/** Every index at which `needle` occurs in `text`. */
function occurrences(text: string, needle: string): number[] {
  const found: number[] = [];
  let index = text.indexOf(needle);

  while (index !== -1) {
    found.push(index);
    index = text.indexOf(needle, index + needle.length);
  }

  return found;
}

/** The line break the file already uses, so an inserted section matches it. */
function lineBreakOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Put `section` between the generated-section markers of `existing`.
 *
 * - `existing` undefined (no file): the markers and the section, alone.
 * - no markers: the existing text unchanged, then a blank line, then the
 *   markers and the section at the end.
 * - one start marker followed by one end marker: only the bytes between them
 *   are replaced; the markers and everything outside them stay byte-for-byte.
 *
 * Throws `WL7501` when the markers are malformed (one without the other, a
 * duplicate, or the end before the start) — rather than guess which part is
 * hand-written.
 *
 * @param existing The current file content, or `undefined` when the file does not exist.
 * @param section The generated markdown, without markers.
 */
export function upsertGeneratedSection(existing: string | undefined, section: string): string {
  const eol = existing === undefined ? "\n" : lineBreakOf(existing);
  const body = section.replace(/\r?\n/g, eol).replace(/(?:\r?\n)+$/, "");
  const block = `${AGENTS_MD_START}${eol}${body}${eol}${AGENTS_MD_END}`;

  if (existing === undefined) return `${block}${eol}`;

  const starts = occurrences(existing, AGENTS_MD_START);
  const ends = occurrences(existing, AGENTS_MD_END);

  if (starts.length === 0 && ends.length === 0) {
    if (existing.length === 0) return `${block}${eol}`;

    const separator = existing.endsWith(eol) ? eol : `${eol}${eol}`;

    return `${existing}${separator}${block}${eol}`;
  }

  const [start] = starts;
  const [end] = ends;

  if (starts.length !== 1 || ends.length !== 1 || start === undefined || end === undefined) {
    throw new WarlockError(
      "WL7501",
      `AGENTS.md has ${starts.length} "${AGENTS_MD_START}" and ${ends.length} "${AGENTS_MD_END}" marker(s); expected exactly one of each. Fix the markers by hand — nothing was written.`,
    );
  }

  if (end < start) {
    throw new WarlockError(
      "WL7501",
      `AGENTS.md has "${AGENTS_MD_END}" before "${AGENTS_MD_START}". Fix the markers by hand — nothing was written.`,
    );
  }

  return `${existing.slice(0, start)}${block}${existing.slice(end + AGENTS_MD_END.length)}`;
}

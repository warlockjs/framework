import type { Comment } from "oxc-parser";

/** What the comment block at the top of a file says. */
export type FileHeader = {
  /** First sentence of the description, or `null` when the file has no header comment. */
  about: string | null;
  /** `@tag value` lines of the header, grouped by tag name (without the `@`). */
  tags: Record<string, string[]>;
};

const DIRECTIVE = /^\s*(?:eslint|oxlint|prettier|istanbul|c8|v8|@ts-|@vitest|@jsx|biome|#)/i;
const SUMMARY_TAGS = ["fileoverview", "file", "overview", "description", "module"];

/** The text lines of one comment, without the comment markers. */
function commentLines(comment: Comment): string[] {
  const lines = comment.value.split(/\r?\n/);

  if (comment.type === "Line") return lines.map((line) => line.replace(/^ /, ""));

  return lines.map((line) => line.replace(/^\s*\*+(?!\/)\s?/, "").replace(/\s+$/, ""));
}

/** First sentence of the first paragraph, whitespace collapsed; `null` when empty. */
export function firstSentence(lines: readonly string[]): string | null {
  const paragraph: string[] = [];

  for (const line of lines) {
    if (line.trim() === "") {
      if (paragraph.length > 0) break;
      continue;
    }

    paragraph.push(line.trim());
  }

  const text = paragraph.join(" ").replace(/\s+/g, " ");

  if (text === "") return null;

  return /^.+?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
}

/** Split comment lines into the description lines and the `@tag` map. */
function splitTags(lines: readonly string[]): {
  description: string[];
  tags: Record<string, string[]>;
} {
  const description: string[] = [];
  const tags: Record<string, string[]> = {};
  let current: { name: string; value: string[] } | undefined;
  const flush = (): void => {
    if (!current) return;
    (tags[current.name] ??= []).push(current.value.join(" ").replace(/\s+/g, " ").trim());
    current = undefined;
  };

  for (const line of lines) {
    const tag = /^\s*@([\w-]+)\s*(.*)$/.exec(line);

    if (tag) {
      flush();
      current = { name: (tag[1] ?? "").toLowerCase(), value: [tag[2] ?? ""] };
    } else if (current) {
      if (line.trim() === "") flush();
      else current.value.push(line.trim());
    } else description.push(line);
  }

  flush();

  return { description, tags };
}

/**
 * The comment block before the first statement (a run of adjacent comments),
 * skipping tool directives such as `eslint-disable`.
 */
export function readFileHeader(
  source: string,
  comments: readonly Comment[],
  firstStatementStart: number,
): FileHeader {
  let group: Comment[] = [];
  const done = (): FileHeader | undefined => {
    const lines = group
      .filter((comment) => !DIRECTIVE.test(comment.value.replace(/^\*+/, "").trimStart()))
      .flatMap(commentLines);

    if (lines.every((line) => line.trim() === "")) return undefined;

    const { description, tags } = splitTags(lines);
    let about = firstSentence(description);

    if (about === null)
      for (const name of SUMMARY_TAGS) {
        const value = tags[name]?.[0];

        if (value) {
          about = firstSentence([value]);
          break;
        }
      }

    return { about, tags };
  };

  for (const comment of comments) {
    if (comment.start >= firstStatementStart) break;

    const previous = group[group.length - 1];

    if (previous && source.slice(previous.end, comment.start).trim() !== "") {
      const header = done();

      if (header) return header;
      group = [];
    }

    group.push(comment);
  }

  return (group.length > 0 ? done() : undefined) ?? { about: null, tags: {} };
}

/**
 * First sentence of the `/** … *\/` block that sits directly above a statement
 * starting at `statementStart`, or `null`. `cursor` walks the sorted comments
 * so a whole file is scanned once.
 */
export function createDocLookup(
  source: string,
  comments: readonly Comment[],
): (statementStart: number) => { text: string | null; fileoverview: boolean } {
  let index = 0;

  return (statementStart) => {
    while (index < comments.length && (comments[index]?.end ?? Infinity) <= statementStart) index++;

    const comment = comments[index - 1];
    const none = { text: null, fileoverview: false };

    if (
      !comment ||
      comment.type !== "Block" ||
      !comment.value.startsWith("*") ||
      source.slice(comment.end, statementStart).trim() !== ""
    )
      return none;

    const { description, tags } = splitTags(commentLines(comment));

    return { text: firstSentence(description), fileoverview: "fileoverview" in tags };
  };
}

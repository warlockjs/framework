/**
 * One pass over a written file's lines: front matter, headings, `##`
 * sections and the logical lines of a list section. Every parser of a
 * written file starts from the `WrittenDocument` this module builds, so a
 * file is split once and scanned line by line, never re-scanned whole.
 */
import type { SourceLocation } from "../contracts/location";
import { readFrontMatter, type FrontMatterField } from "../front-matter";
import type { FindingSink } from "./sink";

/** One line of the body, trailing whitespace (and `\r`) removed. */
export type BodyLine = {
  text: string;
  /** 1-based line in the file. */
  line: number;
  /** Inside a fenced code block (the fence lines included). */
  fenced: boolean;
};

/** A Markdown heading outside code fences. */
export type Heading = {
  level: number;
  text: string;
  line: number;
};

/** A `##` heading and the body lines up to the next `#` or `##` heading. */
export type Section = {
  title: string;
  /** `title` lower-cased with single spaces, for comparing with the template. */
  key: string;
  line: number;
  lines: BodyLine[];
};

/** A written file split into its parts. */
export type WrittenDocument = {
  file: string;
  /** Every line of the file, `\r` removed, trailing whitespace kept. */
  raw: string[];
  /** `null` when the file has no front matter (or it was never closed). */
  fields: Map<string, FrontMatterField> | null;
  /** The body lines (after the front matter). */
  body: BodyLine[];
  /** The first `#` heading. */
  title: Heading | null;
  /** Every `##` section, in order. */
  sections: Section[];
  /** 1-based line of the body's first line. */
  bodyStartLine: number;
};

/** A list item with its indented continuation lines joined by one space. */
export type LogicalLine = {
  text: string;
  line: number;
};

const HEADING = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?$/;
const FENCE = /^[ \t]*(?:```|~~~)/;
const ITEM_START = /^(?:[-*][ \t]|\d+\.[ \t])/;

/** Lower-case a heading or a question and collapse its spaces. */
export function normalizeKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Split text into lines on `\n`, `\r\n` or a lone `\r`. A leading BOM is dropped. */
export function splitLines(text: string): string[] {
  return text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);
}

/** A location of a whole line. */
export function lineAt(file: string, line: number): SourceLocation {
  return { file, line, column: null };
}

/**
 * Read a written file: its front matter (GR1001 when `frontMatter` is
 * `"required"` and the file has none; GR1002 for lines it cannot read),
 * then its headings and `##` sections.
 */
export function readDocument(
  file: string,
  text: string,
  frontMatter: "required" | "none",
  sink: FindingSink,
): WrittenDocument {
  const raw = splitLines(text);
  let fields: Map<string, FrontMatterField> | null = null;
  let bodyStartLine = 1;

  if (frontMatter === "required" || raw[0]?.trim() === "---") {
    const result = readFrontMatter(raw.join("\n"), file);

    // A file with no front matter in its template may start with a `---`
    // rule that is never closed: that is body text, not a broken block.
    if (frontMatter === "required" || result.fields !== null) {
      for (const error of result.errors) sink.push(error);

      fields = result.fields;
      bodyStartLine = result.bodyStartLine;
    }

    if (fields === null && result.errors.length === 0 && frontMatter === "required") {
      sink.report(
        "GR1001",
        "the file has no front matter; it must start with a `---` line.",
        lineAt(file, 1),
      );
    }
  }

  const body: BodyLine[] = [];
  const headings: Heading[] = [];
  let inFence = false;

  for (let index = bodyStartLine - 1; index < raw.length; index++) {
    const text = (raw[index] ?? "").trimEnd();
    const line = index + 1;
    const fenceLine = FENCE.test(text);

    if (fenceLine) inFence = !inFence;

    const fenced = inFence || fenceLine;
    body.push({ text, line, fenced });

    if (fenced) continue;

    const heading = HEADING.exec(text);

    if (heading)
      headings.push({ level: (heading[1] ?? "").length, text: (heading[2] ?? "").trim(), line });
  }

  const sections: Section[] = [];
  let title: Heading | null = null;
  let current: Section | null = null;
  const firstBodyLine = body[0]?.line ?? bodyStartLine;
  let headingIndex = 0;

  for (const bodyLine of body) {
    const heading = headings[headingIndex];

    if (heading !== undefined && heading.line === bodyLine.line) {
      headingIndex++;

      if (heading.level === 1) {
        title ??= heading;
        current = null;
        continue;
      }

      if (heading.level === 2) {
        current = {
          title: heading.text,
          key: normalizeKey(heading.text),
          line: heading.line,
          lines: [],
        };
        sections.push(current);
        continue;
      }
    }

    current?.lines.push(bodyLine);
  }

  return {
    file,
    raw,
    fields,
    body,
    title,
    sections,
    bodyStartLine: Math.min(firstBodyLine, raw.length) || 1,
  };
}

/** The first section with this (normalised) title. */
export function findSection(document: WrittenDocument, key: string): Section | null {
  return document.sections.find((section) => section.key === key) ?? null;
}

/**
 * GR1006 for each required `##` heading that is missing (and for a missing
 * `#` title when `title` is required); GR1007 for each `##` heading the
 * template does not have, or one written twice.
 */
export function checkHeadings(
  document: WrittenDocument,
  template: { title: boolean; required: readonly string[]; optional: readonly string[] },
  sink: FindingSink,
): void {
  const where = lineAt(document.file, document.title?.line ?? document.bodyStartLine);

  if (template.title && document.title === null) {
    sink.report("GR1006", "the file has no `# ` title heading.", where);
  }

  for (const required of template.required) {
    if (!document.sections.some((section) => section.key === normalizeKey(required))) {
      sink.report("GR1006", `the heading "## ${required}" is missing.`, where);
    }
  }

  const known = new Set([...template.required, ...template.optional].map(normalizeKey));
  const seen = new Set<string>();

  for (const section of document.sections) {
    if (!known.has(section.key)) {
      sink.report(
        "GR1007",
        `the heading "## ${section.title}" is not part of the template.`,
        lineAt(document.file, section.line),
      );
    } else if (seen.has(section.key)) {
      sink.report(
        "GR1007",
        `the heading "## ${section.title}" is written twice; only the first is read.`,
        lineAt(document.file, section.line),
      );
    }

    seen.add(section.key);
  }
}

/**
 * The logical lines of some body lines: a line that does not start with
 * whitespace (or that starts a list item) opens a new logical line, and the
 * indented lines right after it are joined to it with one space. Blank lines
 * and fenced lines end the current one.
 */
export function logicalLines(lines: readonly BodyLine[]): LogicalLine[] {
  const result: LogicalLine[] = [];
  let open: LogicalLine | null = null;

  for (const bodyLine of lines) {
    const trimmed = bodyLine.text.trim();

    if (bodyLine.fenced || trimmed === "") {
      open = null;
      continue;
    }

    const indented = /^[ \t]/.test(bodyLine.text);

    if (open !== null && indented && !ITEM_START.test(trimmed)) {
      open.text = `${open.text} ${trimmed}`;
      continue;
    }

    open = { text: trimmed, line: bodyLine.line };
    result.push(open);
  }

  return result;
}

/** The first paragraph after the `# ` title: non-blank lines up to a blank line or a heading. */
export function paragraphAfterTitle(document: WrittenDocument): string | null {
  if (document.title === null) return null;

  const parts: string[] = [];

  for (const bodyLine of document.body) {
    if (bodyLine.line <= document.title.line) continue;

    const trimmed = bodyLine.text.trim();

    if (bodyLine.fenced || trimmed.startsWith("#")) break;

    if (trimmed === "") {
      if (parts.length > 0) break;
      continue;
    }

    parts.push(trimmed);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

/** The body text after the `# ` title (or the whole body), trimmed. */
export function textAfterTitle(document: WrittenDocument, endLine?: number): string {
  const from = document.title?.line ?? 0;

  return document.body
    .filter(
      (bodyLine) => bodyLine.line > from && (endLine === undefined || bodyLine.line < endLine),
    )
    .map((bodyLine) => bodyLine.text)
    .join("\n")
    .trim();
}

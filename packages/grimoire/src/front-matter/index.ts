/**
 * Reads the restricted front matter of a written file. The grammar, and
 * nothing more:
 *
 * ```md
 * ---
 * id: catalog
 * title: "Product catalog"
 * apps: [web-client, mobile]
 * folders:
 *   - src/app/catalog
 *   - src/web/$sites/client/products
 * ---
 * ```
 *
 * - The file starts with a `---` line (after an optional BOM); the block ends
 *   at the next `---` line.
 * - Each line is `key: value`. Keys are lower-case letters, digits, `-` and `_`.
 * - A value is a scalar (quotes around it are removed), an inline list
 *   `[a, b]`, or empty with `- item` lines following it (a block list).
 * - Blank lines are ignored. Anything else is an error with its line.
 */
import { createFinding } from "../codes";
import type { GrimoireFinding } from "../contracts/findings";

/** A front matter value: a scalar or a list. */
export type FrontMatterValue = string | string[];

/** One key with its value and where it was written. */
export type FrontMatterField = {
  key: string;
  value: FrontMatterValue;
  /** 1-based line of the key. */
  line: number;
  /** 1-based line of each list item (the key's line for an inline list). */
  itemLines: number[];
};

/** A file split into its front matter and body. */
export type FrontMatterResult = {
  /** `null` when the file does not start with `---`. */
  fields: Map<string, FrontMatterField> | null;
  /** Everything after the closing `---` (or the whole text without front matter). */
  body: string;
  /** 1-based line of the body's first line in the file. */
  bodyStartLine: number;
  /** `GR1002` findings for lines that could not be read. */
  errors: GrimoireFinding[];
};

const KEY_LINE = /^([a-z][a-z0-9_-]*):(?:\s+(.*?))?\s*$/;
const ITEM_LINE = /^\s*-\s+(.*?)\s*$/;
const FENCE = /^---\s*$/;

function unquote(value: string): string {
  const trimmed = value.trim();

  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function inlineList(value: string): string[] | undefined {
  if (!value.startsWith("[") || !value.endsWith("]")) return undefined;

  const inner = value.slice(1, -1).trim();

  return inner === "" ? [] : inner.split(",").map(unquote);
}

/**
 * Split `text` into front matter and body.
 *
 * @param text The file's content.
 * @param file Project-relative path, used in the findings' locations.
 */
export function readFrontMatter(text: string, file: string): FrontMatterResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const errors: GrimoireFinding[] = [];
  const fail = (line: number, message: string): void => {
    errors.push(createFinding({ code: "GR1002", message, at: { file, line, column: null } }));
  };

  if (lines[0] === undefined || !FENCE.test(lines[0])) {
    return { fields: null, body: lines.join("\n"), bodyStartLine: 1, errors };
  }

  const end = lines.findIndex((line, index) => index > 0 && FENCE.test(line));

  if (end === -1) {
    fail(1, "the front matter starts with `---` but is never closed by another `---` line.");

    return { fields: null, body: "", bodyStartLine: lines.length + 1, errors };
  }

  const fields = new Map<string, FrontMatterField>();
  let open: FrontMatterField | undefined;

  for (let index = 1; index < end; index++) {
    const raw = lines[index] ?? "";
    const lineNumber = index + 1;

    if (raw.trim() === "") continue;

    const item = ITEM_LINE.exec(raw);

    if (item && open && Array.isArray(open.value)) {
      open.value.push(unquote(item[1] ?? ""));
      open.itemLines.push(lineNumber);
      continue;
    }

    const match = KEY_LINE.exec(raw);

    if (!match) {
      fail(lineNumber, `front matter line ${JSON.stringify(raw.trim())} is not \`key: value\`.`);
      open = undefined;
      continue;
    }

    const key = match[1] ?? "";
    const rawValue = (match[2] ?? "").trim();

    if (fields.has(key)) {
      fail(lineNumber, `front matter key "${key}" is written twice.`);
      open = undefined;
      continue;
    }

    const list = inlineList(rawValue);
    const field: FrontMatterField =
      rawValue === ""
        ? { key, value: [], line: lineNumber, itemLines: [] }
        : list
          ? { key, value: list, line: lineNumber, itemLines: list.map(() => lineNumber) }
          : { key, value: unquote(rawValue), line: lineNumber, itemLines: [] };

    fields.set(key, field);
    open = rawValue === "" ? field : undefined;
  }

  return {
    fields,
    body: lines.slice(end + 1).join("\n"),
    bodyStartLine: end + 2,
    errors,
  };
}

/** A field's value as a string; a list is joined with `, `. `undefined` when absent. */
export function frontMatterString(
  fields: Map<string, FrontMatterField> | null,
  key: string,
): string | undefined {
  const field = fields?.get(key);

  if (!field) return undefined;

  return Array.isArray(field.value) ? field.value.join(", ") : field.value;
}

/** A field's value as a list; a scalar becomes a one-item list. `[]` when absent. */
export function frontMatterList(
  fields: Map<string, FrontMatterField> | null,
  key: string,
): string[] {
  const field = fields?.get(key);

  if (!field) return [];

  return Array.isArray(field.value) ? [...field.value] : field.value === "" ? [] : [field.value];
}

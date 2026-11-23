/**
 * A small source scanner shared by the code rules and the assertion counter.
 * It is not a parser: it walks the text once and tells comments and string
 * literals from code, well enough for line rules.
 *
 * Limits: JSX text and regular expression literals are read as code, so an
 * apostrophe in JSX text starts a string that ends at the end of its line
 * (single and double quoted strings never span lines).
 */

/** What kind of file is scanned: `code` (TS/JS), `css` (comments `/* *\/` only), `scss` (also `//`) or `json` (no comments). */
export type ScanMode = "code" | "css" | "scss" | "json";

/** One string literal (or one literal part of a template literal). */
export type ScannedString = {
  /** The text between the quotes, as written (escapes are not decoded). */
  text: string;
  /** 1-based line of the first character of `text`. */
  line: number;
  /** 1-based column of the first character of `text`. */
  column: number;
  /** Offset of the opening quote in the source. */
  quoteStart: number;
  /** `true` when, in `json` mode, the string is an object key. */
  isKey: boolean;
};

/** One comment. */
export type ScannedComment = { text: string; startLine: number; endLine: number };

/** The result of {@link scanSource}. Both text versions have the length and the line breaks of the source. */
export type ScannedSource = {
  /** The source with comments blanked to spaces; strings kept. */
  stripped: string;
  /** The source with comments and string contents blanked (the quotes stay). */
  bare: string;
  strings: ScannedString[];
  comments: ScannedComment[];
};

const blank = (text: string): string => text.replace(/[^\r\n]/g, " ");

/** Scan `text`. */
export function scanSource(text: string, mode: ScanMode = "code"): ScannedSource {
  const stripped: string[] = [];
  const bare: string[] = [];
  const strings: ScannedString[] = [];
  const comments: ScannedComment[] = [];
  const length = text.length;
  // Line starts, to turn an offset into line and column.
  let line = 1;
  let lineStart = 0;
  let index = 0;
  // Template literals: `${` pushes the brace depth to return to.
  const templates: number[] = [];
  let braces = 0;

  const emit = (strippedPart: string, barePart: string): void => {
    stripped.push(strippedPart);
    bare.push(barePart);
  };

  const advanceLines = (chunk: string, from: number): void => {
    for (let at = 0; at < chunk.length; at++) {
      if (chunk[at] === "\n") {
        line++;
        lineStart = from + at + 1;
      }
    }
  };

  const readQuoted = (quote: string): void => {
    const start = index;
    const startLine = line;
    const startColumn = index + 2 - lineStart;
    let cursor = index + 1;

    while (cursor < length) {
      const char = text[cursor];

      if (char === "\\") {
        cursor += 2;
        continue;
      }

      if (char === quote || char === "\n") break;

      cursor++;
    }

    const closed = text[cursor] === quote;
    const content = text.slice(start + 1, Math.min(cursor, length));
    const end = closed ? cursor + 1 : cursor;
    let isKey = false;

    if (mode === "json") {
      const after = /^\s*:/.exec(text.slice(end, end + 200));

      isKey = after !== null;
    }

    strings.push({ text: content, line: startLine, column: startColumn, quoteStart: start, isKey });
    emit(text.slice(start, end), `${quote}${blank(content)}${closed ? quote : ""}`);
    advanceLines(text.slice(start, end), start);
    index = end;
  };

  // Reads a template literal part up to `${` or the closing backtick.
  const readTemplatePart = (): void => {
    const start = index;
    const startLine = line;
    const startColumn = index + 2 - lineStart;
    let cursor = index + 1;
    let ends: "quote" | "expression" | "eof" = "eof";

    while (cursor < length) {
      const char = text[cursor];

      if (char === "\\") {
        cursor += 2;
        continue;
      }

      if (char === "`") {
        ends = "quote";
        break;
      }

      if (char === "$" && text[cursor + 1] === "{") {
        ends = "expression";
        break;
      }

      cursor++;
    }

    cursor = Math.min(cursor, length);

    const content = text.slice(start + 1, cursor);
    const opener = text[start] ?? "`";
    const closer = ends === "quote" ? "`" : ends === "expression" ? "${" : "";

    strings.push({ text: content, line: startLine, column: startColumn, quoteStart: start, isKey: false });
    emit(`${opener}${content}${closer}`, `${opener}${blank(content)}${closer}`);
    advanceLines(text.slice(start, cursor + closer.length), start);

    if (ends === "expression") templates.push(braces);

    index = cursor + closer.length;
  };

  while (index < length) {
    const char = text[index] ?? "";
    const next = text[index + 1];

    if (mode !== "json" && char === "/" && next === "*") {
      const close = text.indexOf("*/", index + 2);
      const end = close === -1 ? length : close + 2;
      const chunk = text.slice(index, end);
      const startLine = line;

      advanceLines(chunk, index);
      comments.push({ text: chunk, startLine, endLine: line });
      emit(blank(chunk), blank(chunk));
      index = end;
      continue;
    }

    if ((mode === "code" || mode === "scss") && char === "/" && next === "/") {
      // `://` inside a URL string never reaches here: strings are read whole.
      let end = text.indexOf("\n", index);

      if (end === -1) end = length;

      const chunk = text.slice(index, end);

      comments.push({ text: chunk, startLine: line, endLine: line });
      emit(blank(chunk), blank(chunk));
      index = end;
      continue;
    }

    if (char === '"' || char === "'") {
      readQuoted(char);
      continue;
    }

    if (mode === "code" && char === "`") {
      readTemplatePart();
      continue;
    }

    if (mode === "code") {
      if (char === "{") braces++;

      if (char === "}") {
        if (templates.length > 0 && templates[templates.length - 1] === braces) {
          templates.pop();
          // The closing brace of `${…}`: the template continues.
          emit("}", "}");
          index++;
          // Re-enter the template text after the brace.
          const resume = index - 1;
          const startLine = line;
          const startColumn = index + 1 - lineStart;
          let cursor = index;
          let ends: "quote" | "expression" | "eof" = "eof";

          while (cursor < length) {
            const inner = text[cursor];

            if (inner === "\\") {
              cursor += 2;
              continue;
            }

            if (inner === "`") {
              ends = "quote";
              break;
            }

            if (inner === "$" && text[cursor + 1] === "{") {
              ends = "expression";
              break;
            }

            cursor++;
          }

          cursor = Math.min(cursor, length);

          const content = text.slice(index, cursor);
          const closer = ends === "quote" ? "`" : ends === "expression" ? "${" : "";

          strings.push({
            text: content,
            line: startLine,
            column: startColumn,
            quoteStart: resume,
            isKey: false,
          });
          emit(`${content}${closer}`, `${blank(content)}${closer}`);
          advanceLines(text.slice(index, cursor + closer.length), index);

          if (ends === "expression") templates.push(braces);

          index = cursor + closer.length;
          continue;
        }

        braces--;
      }
    }

    if (char === "\n") {
      line++;
      lineStart = index + 1;
    }

    emit(char, char);
    index++;
  }

  return { stripped: stripped.join(""), bare: bare.join(""), strings, comments };
}

/** The 1-based line of an offset. */
export function lineOfOffset(text: string, offset: number): number {
  let line = 1;

  for (let at = 0; at < offset && at < text.length; at++) {
    if (text[at] === "\n") line++;
  }

  return line;
}

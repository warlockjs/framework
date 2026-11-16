import type { ConnectorInsertion } from "./insert-connector-entry";

/**
 * Insert one command call into `cli.commands` of `warlock.config.ts` SOURCE TEXT.
 *
 * **String surgery, never parse-and-print**, for the same reason as
 * `insertConnectorEntry`: the file is app-owned and keeps its formatting.
 *
 * - `cli.commands` exists: the call is added to the array the way connectors are
 *   (empty array, single line, one entry per line).
 * - `cli` exists without `commands`: a `commands` property is added to it.
 * - There is no `cli` block: one is added to the `defineConfig({ ... })` object.
 * - The command is already called anywhere in the file's code: nothing changes.
 * - `cli` or `commands` is set some other way (a variable, a spread): the
 *   result is `unrecognised`, since a second key would replace the app's own.
 *
 * Comments and strings are skipped, so a commented-out `cli` block is never
 * edited, and nested brackets in an entry do not end the array early.
 *
 * @param source The config file's current text.
 * @param commandCall The full call to insert, e.g. `"registerGrimoireCommands()"`.
 * @returns What happened, and the new text when there is any.
 */
export function insertCliCommandEntry(source: string, commandCall: string): ConnectorInsertion {
  const commandName = commandCall.slice(0, commandCall.indexOf("("));
  const code = codeOnly(source);

  if (new RegExp(`\\b${escapeForRegExp(commandName)}\\s*\\(`).test(code)) {
    return { status: "already-present" };
  }

  const cliOpen = /\bcli:\s*\{/.exec(code);

  if (cliOpen) {
    const bodyStart = cliOpen.index + cliOpen[0].length;
    const bodyEnd = matchingBracket(code, bodyStart - 1);

    if (bodyEnd === -1) {
      return { status: "unrecognised" };
    }

    const body = code.slice(bodyStart, bodyEnd);
    const commandsOpen = /\bcommands:\s*\[/.exec(body);

    if (commandsOpen) {
      return insertIntoArray(
        source,
        bodyStart + commandsOpen.index + commandsOpen[0].length,
        commandCall,
      );
    }

    // `commands` comes from a variable or a spread: a second key would replace it.
    if (/\bcommands\b|\.\.\./.test(body)) {
      return { status: "unrecognised" };
    }

    if (source.slice(bodyStart, bodyEnd).trim() === "") {
      return {
        status: "added",
        next: `${source.slice(0, bodyStart)} commands: [${commandCall}] ${source.slice(bodyEnd)}`,
      };
    }

    return {
      status: "added",
      next: addProperty(source, bodyStart, `commands: [${commandCall}]`),
    };
  }

  const configOpen = /defineConfig\(\s*\{/.exec(code);

  if (!configOpen) {
    return { status: "unrecognised" };
  }

  const start = configOpen.index + configOpen[0].length;
  const end = matchingBracket(code, start - 1);

  if (end === -1) {
    return { status: "unrecognised" };
  }

  // `cli` is set another way (`cli: settings`, `cli,`): a second key would replace it.
  if (/\bcli\b/.test(code.slice(start, end))) {
    return { status: "unrecognised" };
  }

  if (source.slice(start, end).trim() === "") {
    return {
      status: "added",
      next: `${source.slice(0, start)} cli: { commands: [${commandCall}] } ${source.slice(end)}`,
    };
  }

  return {
    status: "added",
    next: addProperty(source, start, `cli: { commands: [${commandCall}] }`),
  };
}

/** Add `entry` after an opening bracket, using the same rules as connector arrays. */
export function insertIntoArray(
  source: string,
  afterBracket: number,
  entry: string,
): ConnectorInsertion {
  const code = codeOnly(source);
  const close = matchingBracket(code, afterBracket - 1);

  if (close === -1) {
    return { status: "unrecognised" };
  }

  const inner = code.slice(afterBracket, close);

  if (inner.trim() === "") {
    return {
      status: "added",
      next: `${source.slice(0, afterBracket)}${entry}${source.slice(afterBracket)}`,
    };
  }

  const multiline = /\n([ \t]*)\S/.exec(inner);

  if (multiline) {
    const firstBreak = inner.indexOf("\n");
    const insertAt = afterBracket + firstBreak + 1;
    const indent = multiline[1] ?? "";
    const lineBreak = inner[firstBreak - 1] === "\r" ? "\r\n" : "\n";

    return {
      status: "added",
      next: `${source.slice(0, insertAt)}${indent}${entry},${lineBreak}${source.slice(insertAt)}`,
    };
  }

  return {
    status: "added",
    next: `${source.slice(0, afterBracket)}${entry}, ${source.slice(afterBracket)}`,
  };
}

/**
 * Put `property` first inside the object whose `{` ends at `bodyStart`. A body on
 * the same line gets `property, ` in front; a multi-line body gets its own line,
 * indented like the first existing property.
 */
export function addProperty(source: string, bodyStart: number, property: string): string {
  const rest = source.slice(bodyStart);
  const nextLine = /^[ \t]*(\r?\n)([ \t]*)\S/.exec(rest);

  if (nextLine) {
    const lineBreak = nextLine[1] ?? "\n";
    const indent = nextLine[2] ?? "";
    const insertAt = bodyStart + rest.indexOf(lineBreak) + lineBreak.length;

    return `${source.slice(0, insertAt)}${indent}${property},${lineBreak}${source.slice(insertAt)}`;
  }

  const leading = /^[ \t]*/.exec(rest)?.[0] ?? "";

  return `${source.slice(0, bodyStart)}${leading}${property}, ${rest.slice(leading.length)}`;
}

/**
 * Index of the bracket that closes the `{`, `[` or `(` at `open` in text from
 * {@link codeOnly}, or -1.
 */
export function matchingBracket(code: string, open: number): number {
  const opening = code[open];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : opening === "(" ? ")" : "";
  let depth = 0;

  if (closing === "") return -1;

  for (let index = open; index < code.length; index++) {
    const char = code[index];

    if (char === opening) {
      depth++;
    } else if (char === closing) {
      depth--;

      if (depth === 0) return index;
    }
  }

  return -1;
}

/**
 * `source` with every comment and the inside of every string literal turned into
 * spaces (line breaks kept). Offsets are unchanged, so a search of the result finds
 * code only, and its indexes can be used to cut `source`.
 */
export function codeOnly(source: string): string {
  const blank = (text: string) => text.replace(/[^\r\n]/g, " ");
  let code = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "/" && (next === "/" || next === "*")) {
      const close = next === "/" ? source.indexOf("\n", index) : source.indexOf("*/", index + 2);
      const stop = close === -1 ? source.length : next === "/" ? close : close + 2;

      code += blank(source.slice(index, stop));
      index = stop;
    } else if (char === '"' || char === "'" || char === "`") {
      let cursor = index + 1;

      while (cursor < source.length && source[cursor] !== char) {
        if (char !== "`" && source[cursor] === "\n") break;

        cursor += source[cursor] === "\\" ? 2 : 1;
      }

      cursor = Math.min(cursor, source.length);

      const closed = source[cursor] === char;

      code += `${char}${blank(source.slice(index + 1, cursor))}${closed ? char : ""}`;
      index = closed ? cursor + 1 : cursor;
    } else {
      code += char;
      index++;
    }
  }

  return code;
}

/** Escape a literal string for embedding in a regular expression. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

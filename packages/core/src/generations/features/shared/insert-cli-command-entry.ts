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
 * - The command is already registered anywhere in the file: nothing changes.
 *
 * @param source The config file's current text.
 * @param commandCall The full call to insert, e.g. `"registerGrimoireCommands()"`.
 * @returns What happened, and the new text when there is any.
 */
export function insertCliCommandEntry(source: string, commandCall: string): ConnectorInsertion {
  const commandName = commandCall.slice(0, commandCall.indexOf("("));

  if (new RegExp(`\\b${escapeForRegExp(commandName)}\\s*\\(`).test(source)) {
    return { status: "already-present" };
  }

  const cliOpen = /\bcli:\s*\{/.exec(source);

  if (cliOpen) {
    const bodyStart = cliOpen.index + cliOpen[0].length;
    const bodyEnd = matchingBrace(source, bodyStart - 1);

    if (bodyEnd === -1) {
      return { status: "unrecognised" };
    }

    const body = source.slice(bodyStart, bodyEnd);
    const commandsOpen = /\bcommands:\s*\[/.exec(body);

    if (commandsOpen) {
      return insertIntoArray(
        source,
        bodyStart + commandsOpen.index + commandsOpen[0].length,
        commandCall,
      );
    }

    if (body.trim() === "") {
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

  const configOpen = /defineConfig\(\s*\{/.exec(source);

  if (!configOpen) {
    return { status: "unrecognised" };
  }

  const start = configOpen.index + configOpen[0].length;
  const end = matchingBrace(source, start - 1);

  if (end === -1) {
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
  const closeOffset = source.slice(afterBracket).indexOf("]");

  if (closeOffset === -1) {
    return { status: "unrecognised" };
  }

  const inner = source.slice(afterBracket, afterBracket + closeOffset);

  if (inner.trim() === "") {
    return {
      status: "added",
      next: `${source.slice(0, afterBracket)}${entry}${source.slice(afterBracket)}`,
    };
  }

  const multiline = /\n([ \t]*)\S/.exec(inner);

  if (multiline) {
    const insertAt = afterBracket + inner.indexOf("\n") + 1;
    const indent = multiline[1] ?? "";

    return {
      status: "added",
      next: `${source.slice(0, insertAt)}${indent}${entry},\n${source.slice(insertAt)}`,
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

/** Index of the `}` that closes the `{` at `open`, or -1. Strings and comments are skipped. */
export function matchingBrace(source: string, open: number): number {
  let depth = 0;

  for (let index = open; index < source.length; index++) {
    const char = source[index];

    if (char === '"' || char === "'" || char === "`") {
      const close = source.indexOf(char, index + 1);

      if (close === -1) return -1;

      index = close;
    } else if (char === "/" && source[index + 1] === "/") {
      const lineEnd = source.indexOf("\n", index);

      if (lineEnd === -1) return -1;

      index = lineEnd;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;

      if (depth === 0) return index;
    }
  }

  return -1;
}

/** Escape a literal string for embedding in a regular expression. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

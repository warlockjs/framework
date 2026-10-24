/**
 * Development aid for hydration mismatches. React 19 appends a diff of the
 * mismatching subtree to the message of the recoverable error it reports in
 * development builds:
 *
 * ```
 * <div>
 *   <p>
 * +   Client text
 * -   Server text
 * ```
 *
 * `+` marks the client render and `-` the server HTML. This reads the first
 * `+` / `-` pair out of that diff, together with the chain of elements above
 * it. It returns `undefined` when the message carries no diff (a production
 * build, or a React that formats it differently), so callers log nothing
 * rather than something wrong.
 */
export type HydrationMismatch = {
  /** Element chain above the mismatch, for example `div > ul > li`. */
  path: string;
  /** What the client rendered, when the diff names it. */
  client?: string;
  /** What the server sent, when the diff names it. */
  server?: string;
};

const DIFF_START = "https://react.dev/link/hydration-mismatch";

export function describeHydrationMismatch(message: string): HydrationMismatch | undefined {
  const start = message.indexOf(DIFF_START);

  if (start === -1) return undefined;

  const lines = message
    .slice(start + DIFF_START.length)
    .split("\n")
    .filter((line) => line.trim() !== "");

  const elements: string[] = [];
  let client: string | undefined;
  let server: string | undefined;
  let path: string | undefined;
  let mismatchIndent = 0;

  for (const line of lines) {
    const marker = line[0];

    if (marker !== "+" && marker !== "-" && marker !== " ") return undefined;

    const body = line.slice(2);
    const indent = (body.length - body.trimStart().length) / 2;
    const content = body.trim();

    if (marker === " ") {
      if (path !== undefined) break;

      const tag = /^<([a-zA-Z][\w:.-]*)/.exec(content)?.[1];

      if (tag) {
        elements.length = indent;
        elements[indent] = tag;
      }

      continue;
    }

    if (path === undefined) {
      path = elements.slice(0, indent).filter(Boolean).join(" > ") || "(root)";
      mismatchIndent = indent;
    } else if (indent !== mismatchIndent) {
      break;
    }

    if (marker === "+") client ??= content;
    else server ??= content;
  }

  if (path === undefined) return undefined;

  return { path, client, server };
}

/** The line the development client logs for a mismatch. */
export function formatHydrationMismatch(mismatch: HydrationMismatch): string {
  const parts = [`First hydration mismatch at ${mismatch.path}.`];

  if (mismatch.server !== undefined) parts.push(`Server: ${mismatch.server}`);
  if (mismatch.client !== undefined) parts.push(`Client: ${mismatch.client}`);

  parts.push(
    "If the text comes from Intl or locale-sorted data, Node and the browser can disagree. " +
      "Render it from a shared pre-computed table, or after hydration.",
  );

  return parts.join("\n");
}

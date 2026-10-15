/** What {@link insertConnectorEntry} did, or could not do, to the source it was given. */
export type ConnectorInsertion =
  | { status: "added"; next: string }
  | { status: "already-present" }
  | { status: "unrecognised" };

/**
 * Insert one connector call into the `connectors` array of `warlock.config.ts`
 * SOURCE TEXT.
 *
 * **String surgery, never parse-and-print** — same rationale as
 * `insertIncludeEntry`: `warlock.config.ts` is app-owned and may carry any
 * formatting, and a parse-and-print would reformat parts this call never came
 * to touch.
 *
 * Shared by every feature that registers a connector (`queue`, `web`, …) so the
 * formatting rules below live in exactly one place:
 *
 * - An **empty** array (`[]`) gets the bare call: `[queueConnector()]`.
 * - A **single-line, non-empty** array gets `entry, ` prepended right after
 *   `[`, so `[webConnector()]` becomes `[queueConnector(), webConnector()]` —
 *   WITH the space after the comma.
 * - A **multi-line** array (one connector per line) gets the new entry on its
 *   own line, indented to match the array's existing entries, inserted before
 *   the first one. Whether the last existing entry already carries a trailing
 *   comma is left untouched — both are valid.
 * - A connector already present anywhere in the source (by name, so a call
 *   already registered is found however it is formatted) is left unchanged.
 *
 * @param source The config file's current text.
 * @param connectorCall The full call to insert, e.g. `"queueConnector()"`.
 * @returns What happened, and the new text when there is any.
 */
export function insertConnectorEntry(source: string, connectorCall: string): ConnectorInsertion {
  const connectorName = connectorCall.slice(0, connectorCall.indexOf("("));

  if (new RegExp(`\\b${escapeForRegExp(connectorName)}\\s*\\(`).test(source)) {
    return { status: "already-present" };
  }

  const arrayOpen = /connectors:\s*\[/.exec(source);

  if (!arrayOpen) {
    return { status: "unrecognised" };
  }

  const afterBracket = arrayOpen.index + arrayOpen[0].length;
  const closeBracketOffset = source.slice(afterBracket).indexOf("]");

  if (closeBracketOffset === -1) {
    return { status: "unrecognised" };
  }

  const inner = source.slice(afterBracket, afterBracket + closeBracketOffset);

  if (inner.trim() === "") {
    return {
      status: "added",
      next: `${source.slice(0, afterBracket)}${connectorCall}${source.slice(afterBracket)}`,
    };
  }

  const multilineEntry = /\n([ \t]*)\S/.exec(inner);

  if (multilineEntry) {
    const indent = multilineEntry[1];
    const insertAt = afterBracket + inner.indexOf("\n") + 1;

    return {
      status: "added",
      next:
        `${source.slice(0, insertAt)}${indent}${connectorCall},\n` + `${source.slice(insertAt)}`,
    };
  }

  return {
    status: "added",
    next: `${source.slice(0, afterBracket)}${connectorCall}, ${source.slice(afterBracket)}`,
  };
}

/**
 * Escape a literal string for embedding in a regular expression.
 *
 * @param value The literal to escape.
 * @returns The escaped literal.
 */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

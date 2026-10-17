import { BOARD_VERDICT_LINES, type BoardVerdict } from "./board.types";

/** The fields a message file's front matter carries. */
export type BoardMessageFields = {
  from: string;
  to: string;
  item: number | null;
  subject: string;
  at: string;
};

/** A message file's contents, parsed. */
export type ParsedBoardMessage = BoardMessageFields & {
  body: string;
  verdict: BoardVerdict | null;
};

/** Subjects are one line: newlines would break the front matter. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Render a message file: front matter (`from`, `to`, `item`, `subject`, `at`),
 * a blank line, the body, and — for a verdict — a final line that is exactly
 * `VERDICT: APPROVED` or `VERDICT: CHANGES REQUESTED`.
 */
export function formatBoardMessage(
  fields: BoardMessageFields,
  body: string,
  verdict: BoardVerdict | null = null,
): string {
  const lines = [
    "---",
    `from: ${oneLine(fields.from)}`,
    `to: ${oneLine(fields.to)}`,
    `item: ${fields.item ?? ""}`,
    `subject: ${oneLine(fields.subject)}`,
    `at: ${fields.at}`,
    "---",
    "",
  ];
  const text = body.replace(/\s+$/, "");

  if (text.length > 0) lines.push(text);

  if (verdict) {
    if (text.length > 0) lines.push("");
    lines.push(BOARD_VERDICT_LINES[verdict]);
  }

  return `${lines.join("\n")}\n`;
}

/** The verdict a line spells, or `null`. */
function verdictOf(line: string): BoardVerdict | null {
  const trimmed = line.trim();

  if (trimmed === BOARD_VERDICT_LINES.approved) return "approved";
  if (trimmed === BOARD_VERDICT_LINES["changes-requested"]) return "changes-requested";

  return null;
}

/**
 * Parse a message file. Tolerates a file without front matter (everything is
 * the body). The verdict is read from the last non-empty line only, so a
 * quoted verdict inside the body does not count.
 */
export function parseBoardMessage(text: string): ParsedBoardMessage {
  const fields: BoardMessageFields = { from: "", to: "", item: null, subject: "", at: "" };
  let rest = text.replace(/\r\n/g, "\n");

  if (rest.startsWith("---\n")) {
    const end = rest.indexOf("\n---", 4);

    if (end !== -1) {
      const header = rest.slice(4, end);

      for (const line of header.split("\n")) {
        const separator = line.indexOf(":");

        if (separator === -1) continue;

        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();

        if (key === "from") fields.from = value;
        else if (key === "to") fields.to = value;
        else if (key === "subject") fields.subject = value;
        else if (key === "at") fields.at = value;
        else if (key === "item") {
          const id = Number.parseInt(value, 10);
          fields.item = Number.isInteger(id) && id > 0 ? id : null;
        }
      }

      rest = rest.slice(end + 4).replace(/^\n+/, "");
    }
  }

  const lines = rest.replace(/\s+$/, "").split("\n");
  const last = lines[lines.length - 1] ?? "";
  const verdict = verdictOf(last);

  if (verdict) lines.pop();

  return { ...fields, body: lines.join("\n").replace(/\s+$/, ""), verdict };
}

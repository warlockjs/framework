/**
 * A small, dependency-free unified diff, in the format `git diff` and
 * `patch -p1` read: `--- a/<path>` / `+++ b/<path>` headers (`/dev/null` for a
 * created or deleted file), `@@ -l,c +l,c @@` hunks with three lines of
 * context, and `\ No newline at end of file` markers.
 *
 * Lines are matched with a longest-common-subsequence table after the common
 * prefix and suffix are trimmed. Generated files are small, so that is plenty;
 * a pair too large for the table falls back to "every line replaced", which is
 * still a correct (if larger) diff.
 */

/** Lines of context around each change. */
export const DIFF_CONTEXT_LINES = 3;

/** Above this many table cells the LCS falls back to a full replace. */
const MAX_LCS_CELLS = 4_000_000;

/** A marker appended to the compare key of a last line without a newline. */
const NO_EOL = "\u0000no-eol";

type Operation = { type: " " | "-" | "+"; key: string };

/** Split text into compare keys: one per line, the last one marked when it has no newline. */
function toLines(text: string): string[] {
  if (text.length === 0) return [];

  const lines = text.split("\n");
  const endsWithNewline = lines[lines.length - 1] === "";

  if (endsWithNewline) {
    lines.pop();
    return lines;
  }

  const last = lines.length - 1;

  return lines.map((line, index) => (index === last ? `${line}${NO_EOL}` : line));
}

/** The edit script turning `before` into `after`. */
function diffLines(before: readonly string[], after: readonly string[]): Operation[] {
  let prefix = 0;

  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix++;
  }

  let suffix = 0;

  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }

  const head: Operation[] = before.slice(0, prefix).map((key) => ({ type: " ", key }));
  const tail: Operation[] = before.slice(before.length - suffix).map((key) => ({ type: " ", key }));
  const oldMiddle = before.slice(prefix, before.length - suffix);
  const newMiddle = after.slice(prefix, after.length - suffix);

  return [...head, ...diffMiddle(oldMiddle, newMiddle), ...tail];
}

/** LCS-based edit script for the part that differs. */
function diffMiddle(before: readonly string[], after: readonly string[]): Operation[] {
  const rows = before.length;
  const columns = after.length;

  if (rows === 0 || columns === 0 || (rows + 1) * (columns + 1) > MAX_LCS_CELLS) {
    return [
      ...before.map((key): Operation => ({ type: "-", key })),
      ...after.map((key): Operation => ({ type: "+", key })),
    ];
  }

  // table[i][j] = LCS length of before[i..] and after[j..], flattened.
  const width = columns + 1;
  const table = new Uint32Array((rows + 1) * width);

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = columns - 1; j >= 0; j--) {
      table[i * width + j] =
        before[i] === after[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }

  const operations: Operation[] = [];
  let i = 0;
  let j = 0;

  while (i < rows && j < columns) {
    const oldLine = before[i] ?? "";
    const newLine = after[j] ?? "";

    if (oldLine === newLine) {
      operations.push({ type: " ", key: oldLine });
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      operations.push({ type: "-", key: oldLine });
      i++;
    } else {
      operations.push({ type: "+", key: newLine });
      j++;
    }
  }

  for (; i < rows; i++) operations.push({ type: "-", key: before[i] ?? "" });
  for (; j < columns; j++) operations.push({ type: "+", key: after[j] ?? "" });

  return operations;
}

function renderLine(operation: Operation): string {
  if (operation.key.endsWith(NO_EOL)) {
    return `${operation.type}${operation.key.slice(0, -NO_EOL.length)}\n\\ No newline at end of file`;
  }

  return `${operation.type}${operation.key}`;
}

/** `start,count` of one side of a hunk header, GNU style (a zero count names the line before). */
function range(start: number, count: number): string {
  return `${count === 0 ? start : start + 1},${count}`;
}

/** Inputs of {@link unifiedDiff}. */
export type UnifiedDiffInput = {
  /** Project-relative POSIX path, used in the headers. */
  path: string;
  /** The old content; `null` when the file is created. */
  before: string | null;
  /** The new content; `null` when the file is deleted. */
  after: string | null;
  /** Lines of context. Default {@link DIFF_CONTEXT_LINES}. */
  context?: number;
};

/**
 * The unified diff between two versions of one file, or `""` when they are
 * equal.
 *
 * @example
 * unifiedDiff({ path: "src/app/users/routes.ts", before: "a\n", after: "a\nb\n" });
 * // --- a/src/app/users/routes.ts
 * // +++ b/src/app/users/routes.ts
 * // @@ -1,1 +1,2 @@
 * //  a
 * // +b
 */
export function unifiedDiff(input: UnifiedDiffInput): string {
  const context = input.context ?? DIFF_CONTEXT_LINES;

  if (input.before !== null && input.after !== null && input.before === input.after) return "";

  const operations = diffLines(toLines(input.before ?? ""), toLines(input.after ?? ""));
  const changes = operations.flatMap((operation, index) => (operation.type === " " ? [] : [index]));

  const header = [
    input.before === null ? "--- /dev/null" : `--- a/${input.path}`,
    input.after === null ? "+++ /dev/null" : `+++ b/${input.path}`,
  ];

  if (changes.length === 0) {
    // Same lines, different bytes the line split cannot see (only possible
    // for an empty file created or deleted): headers alone still say it.
    return `${header.join("\n")}\n`;
  }

  const groups: { first: number; last: number }[] = [];

  for (const index of changes) {
    const current = groups[groups.length - 1];

    if (current && index - current.last - 1 <= context * 2) {
      current.last = index;
    } else {
      groups.push({ first: index, last: index });
    }
  }

  const lines = [...header];

  for (const group of groups) {
    const from = Math.max(0, group.first - context);
    const to = Math.min(operations.length - 1, group.last + context);
    let oldStart = 0;
    let newStart = 0;

    for (let index = 0; index < from; index++) {
      const type = operations[index]?.type;

      if (type !== "+") oldStart++;
      if (type !== "-") newStart++;
    }

    const slice = operations.slice(from, to + 1);
    const oldCount = slice.filter((operation) => operation.type !== "+").length;
    const newCount = slice.filter((operation) => operation.type !== "-").length;

    lines.push(`@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`);
    lines.push(...slice.map(renderLine));
  }

  return `${lines.join("\n")}\n`;
}

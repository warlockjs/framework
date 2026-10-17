/**
 * A minimal unified diff (`diff -u` shape, 3 lines of context) between two
 * versions of one file, enough for `warlock upgrade --dry-run` to show what
 * it would change. Line-based longest common subsequence; files too large for
 * that are shown as one replaced hunk.
 */
const CONTEXT = 3;
const MAX_CELLS = 16_000_000;

type Operation = { type: "same" | "removed" | "added"; text: string };

export function unifiedDiff(file: string, before: string, after: string): string {
  if (before === after) return "";

  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  const operations = diffLines(oldLines, newLines);

  const header = `--- a/${file}\n+++ b/${file}\n`;
  return header + formatHunks(operations);
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function diffLines(oldLines: string[], newLines: string[]): Operation[] {
  const n = oldLines.length;
  const m = newLines.length;

  if (n * m > MAX_CELLS) {
    return [
      ...oldLines.map((text): Operation => ({ type: "removed", text })),
      ...newLines.map((text): Operation => ({ type: "added", text })),
    ];
  }

  // lengths[i][j] = LCS length of oldLines[i..] and newLines[j..]
  const lengths: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) lengths.push(new Uint32Array(m + 1));

  for (let i = n - 1; i >= 0; i--) {
    const row = lengths[i] as Uint32Array;
    const below = lengths[i + 1] as Uint32Array;
    for (let j = m - 1; j >= 0; j--) {
      row[j] =
        oldLines[i] === newLines[j]
          ? (below[j + 1] ?? 0) + 1
          : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const operations: Operation[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      operations.push({ type: "same", text: oldLines[i] ?? "" });
      i++;
      j++;
    } else if ((lengths[i + 1]?.[j] ?? 0) >= (lengths[i]?.[j + 1] ?? 0)) {
      operations.push({ type: "removed", text: oldLines[i] ?? "" });
      i++;
    } else {
      operations.push({ type: "added", text: newLines[j] ?? "" });
      j++;
    }
  }
  while (i < n) operations.push({ type: "removed", text: oldLines[i++] ?? "" });
  while (j < m) operations.push({ type: "added", text: newLines[j++] ?? "" });

  return operations;
}

function formatHunks(operations: Operation[]): string {
  const changed = operations
    .map((operation, index) => (operation.type === "same" ? -1 : index))
    .filter((index) => index >= 0);

  let output = "";
  let cursor = 0;

  while (cursor < changed.length) {
    const firstChange = changed[cursor] ?? 0;
    let lastChange = firstChange;
    // Merge changes whose context windows touch.
    while (cursor + 1 < changed.length && (changed[cursor + 1] ?? 0) - lastChange <= CONTEXT * 2) {
      cursor++;
      lastChange = changed[cursor] ?? lastChange;
    }
    cursor++;

    const start = Math.max(0, firstChange - CONTEXT);
    const end = Math.min(operations.length, lastChange + CONTEXT + 1);

    let oldStart = 1;
    let newStart = 1;
    for (let index = 0; index < start; index++) {
      const type = operations[index]?.type;
      if (type !== "added") oldStart++;
      if (type !== "removed") newStart++;
    }

    let oldCount = 0;
    let newCount = 0;
    let body = "";
    for (let index = start; index < end; index++) {
      const operation = operations[index];
      if (!operation) continue;
      if (operation.type === "same") {
        oldCount++;
        newCount++;
        body += ` ${operation.text}\n`;
      } else if (operation.type === "removed") {
        oldCount++;
        body += `-${operation.text}\n`;
      } else {
        newCount++;
        body += `+${operation.text}\n`;
      }
    }

    const oldRange = oldCount === 0 ? `${oldStart - 1},0` : `${oldStart},${oldCount}`;
    const newRange = newCount === 0 ? `${newStart - 1},0` : `${newStart},${newCount}`;
    output += `@@ -${oldRange} +${newRange} @@\n${body}`;
  }

  return output;
}

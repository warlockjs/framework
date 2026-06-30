import { colors } from "@mongez/copper";
import { methodRank, type RouteRow } from "./route-row";

/** The columns rendered, in order, with their header labels. */
const COLUMNS = [
  { key: "method", header: "METHOD" },
  { key: "path", header: "PATH" },
  { key: "name", header: "NAME" },
  { key: "action", header: "ACTION" },
  { key: "middleware", header: "MW" },
  { key: "source", header: "SOURCE" },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];

/** Two spaces between columns. */
const GAP = "  ";

/** Shown for an empty string cell so the column doesn't read as a gap. */
const EMPTY_CELL = "—";

/**
 * The plain (uncolored) text of one cell. Numbers render as-is; an empty string
 * renders as {@link EMPTY_CELL}. This is the single source of truth for both
 * the width math and the rendered text, so colored and uncolored output stay
 * aligned.
 *
 * @param row - The row
 * @param key - The column key
 * @returns The cell's printable text
 */
function cellText(row: RouteRow, key: ColumnKey): string {
  if (key === "middleware") return String(row.middleware);

  const value = row[key] as string;

  return value.length > 0 ? value : EMPTY_CELL;
}

/**
 * Per-column display width: the longest of the header and every cell.
 *
 * @param rows - The rows to measure
 * @returns One width per column, in column order
 */
function columnWidths(rows: RouteRow[]): number[] {
  return COLUMNS.map((column) =>
    Math.max(column.header.length, ...rows.map((row) => cellText(row, column.key).length)),
  );
}

/**
 * Build a one-line, human-readable summary: the total plus a per-method
 * breakdown ordered by {@link methodRank}, e.g.
 * `42 routes (38 GET · 2 POST · 1 PUT · 1 DELETE)`.
 *
 * @param rows - The rows being summarized
 * @returns The summary line
 */
export function routesSummary(rows: RouteRow[]): string {
  const noun = rows.length === 1 ? "route" : "routes";

  if (rows.length === 0) return `0 ${noun}`;

  const counts = new Map<string, number>();

  for (const row of rows) {
    counts.set(row.method, (counts.get(row.method) ?? 0) + 1);
  }

  const breakdown = [...counts.entries()]
    .sort(([a], [b]) => methodRank(a) - methodRank(b))
    .map(([method, count]) => `${count} ${method}`)
    .join(" · ");

  return `${rows.length} ${noun} (${breakdown})`;
}

/**
 * Render the routes table as an ordered list of plain (uncolored) lines:
 * a header row, one row per route, a blank line, then the summary. Returned as
 * strings (not printed) so the layout is unit-testable without ANSI noise.
 *
 * @param rows - The rows to render (already filtered/sorted by the caller)
 * @returns The lines to print, top to bottom
 */
export function formatRoutesTableLines(rows: RouteRow[]): string[] {
  if (rows.length === 0) {
    return ["No routes registered."];
  }

  const widths = columnWidths(rows);

  const renderRow = (cells: string[]) =>
    cells.map((text, index) => text.padEnd(widths[index])).join(GAP).trimEnd();

  const lines = [renderRow(COLUMNS.map((column) => column.header))];

  for (const row of rows) {
    lines.push(renderRow(COLUMNS.map((column) => cellText(row, column.key))));
  }

  lines.push("");
  lines.push(routesSummary(rows));

  return lines;
}

/** Per-verb color for the METHOD column. Unknown verbs fall back to white. */
const METHOD_COLOR: Record<string, (input: string) => string> = {
  GET: colors.green,
  POST: colors.blue,
  PUT: colors.yellow,
  PATCH: colors.yellow,
  DELETE: colors.red,
  OPTIONS: colors.gray,
  HEAD: colors.gray,
  ALL: colors.magenta,
};

/**
 * Colorize the method label, then right-pad with plain spaces so column
 * alignment is computed from the visible width, not the ANSI-coded length.
 *
 * @param method - The uppercased HTTP verb
 * @param width - The METHOD column width
 * @returns The colored, padded cell
 */
function colorizeMethodCell(method: string, width: number): string {
  const colorize = METHOD_COLOR[method] ?? colors.white;

  return colorize(method) + " ".repeat(Math.max(0, width - method.length));
}

/**
 * Print the routes table to stdout with a bold header, verb-colored METHOD
 * column, and a dimmed summary. The empty case prints a single yellow notice
 * (a booted app with zero routes usually means a route module failed to load).
 *
 * Thin presentation wrapper over {@link formatRoutesTableLines} /
 * {@link routesSummary} — those stay the source of truth for layout.
 *
 * @param rows - The rows to print (already filtered/sorted by the caller)
 */
export function printRoutesTable(rows: RouteRow[]): void {
  if (rows.length === 0) {
    console.log(colors.yellow("No routes registered — did a route module fail to load?"));
    return;
  }

  const widths = columnWidths(rows);

  const headerLine = COLUMNS.map((column, index) => column.header.padEnd(widths[index]))
    .join(GAP)
    .trimEnd();

  console.log(colors.bold(headerLine));

  for (const row of rows) {
    const cells = COLUMNS.map((column, index) => {
      if (column.key === "method") {
        return colorizeMethodCell(row.method, widths[index]);
      }

      return cellText(row, column.key).padEnd(widths[index]);
    });

    console.log(cells.join(GAP).trimEnd());
  }

  console.log("");
  console.log(colors.gray(routesSummary(rows)));
}

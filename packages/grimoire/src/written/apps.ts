/**
 * The files of one app folder: `README.md`, `layouts/<id>.md`,
 * `pages/<id>/README.md`, `screens/<id>/README.md` and their
 * `blocks/<id>.md` files, and the `## Blocks` table they share.
 */
import type {
  WrittenBlockFile,
  WrittenBlockRow,
  WrittenChangesWith,
  WrittenEntryPoint,
  WrittenLayout,
  WrittenListLine,
  WrittenPage,
} from "../contracts/written";
import type { Located } from "../contracts/location";
import { FLOW_REF, FrontMatterReader, checks, projectFolder } from "./fields";
import { readListLines } from "./lists";
import {
  checkHeadings,
  findSection,
  lineAt,
  normalizeKey,
  paragraphAfterTitle,
  readDocument,
  type BodyLine,
  type WrittenDocument,
} from "./markdown";
import type { FindingSink } from "./sink";

/** The parts of `grimoire/apps/<id>/README.md` (the folder's other files are added by the walker). */
export type AppReadme = {
  id: Located<string>;
  type: Located<"site" | "mobile">;
  root: Located<string>;
  heading: Located<string> | null;
  conditions: WrittenListLine[];
};

const BLOCK_COLUMNS = ["block", "flow", "who sees it", "changes with"];
const EMPTY_CELL = /^(?:—|–|-+)?$/;
const SEPARATOR_CELL = /^:?-+:?$/;
const CONDITION_ITEM = /^([a-z][a-z0-9-]*(?::[a-z0-9-]+)?):[ \t]+(\S.*)$/;

function heading(document: WrittenDocument): Located<string> | null {
  return document.title
    ? { value: document.title.text, at: lineAt(document.file, document.title.line) }
    : null;
}

/** The cells of a table row, with or without outer pipes; `\|` stays a pipe inside a cell. */
export function tableCells(row: string): string[] {
  let text = row.trim();

  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);

  return text.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

/**
 * Read the `## Blocks` table: a header row `Block | Flow | Who sees it |
 * Changes with`, a separator row, then one row per block. Text before the
 * table is allowed; the table ends at the first line without a `|`.
 */
export function parseBlocksTable(
  file: string,
  section: { line: number; lines: readonly BodyLine[] },
  sink: FindingSink,
): WrittenBlockRow[] {
  const rows: WrittenBlockRow[] = [];
  const lines = section.lines;
  const start = lines.findIndex((line) => !line.fenced && line.text.includes("|"));

  if (start === -1) {
    sink.report("GR1018", "the Blocks section has no table.", lineAt(file, section.line));

    return rows;
  }

  const header = lines[start];
  const separator = lines[start + 1];

  if (header === undefined) return rows;

  const columns = tableCells(header.text).map(normalizeKey);

  if (
    columns.length !== BLOCK_COLUMNS.length ||
    columns.some((column, index) => column !== BLOCK_COLUMNS[index])
  ) {
    sink.report(
      "GR1018",
      `the Blocks table header is ${JSON.stringify(header.text.trim())}; use the columns Block | Flow | Who sees it | Changes with.`,
      lineAt(file, header.line),
    );

    return rows;
  }

  const separatorCells =
    separator === undefined || separator.fenced ? [] : tableCells(separator.text);

  if (
    separatorCells.length !== BLOCK_COLUMNS.length ||
    !separatorCells.every((cell) => SEPARATOR_CELL.test(cell))
  ) {
    sink.report(
      "GR1018",
      "the Blocks table header is not followed by a separator row (`| --- | --- | --- | --- |`).",
      lineAt(file, separator?.line ?? header.line),
    );

    return rows;
  }

  for (let index = start + 2; index < lines.length; index++) {
    const line = lines[index];

    if (line === undefined || line.fenced || !line.text.includes("|")) break;

    const at = lineAt(file, line.line);
    const cells = tableCells(line.text);

    if (cells.length !== BLOCK_COLUMNS.length) {
      sink.report("GR1018", `the Blocks row has ${cells.length} cells instead of 4.`, at);
      continue;
    }

    const [block = "", flow = "", who = "", changesWith = ""] = cells;

    if (block === "") {
      sink.report("GR1018", "the Blocks row has no block name.", at);
      continue;
    }

    if (!EMPTY_CELL.test(flow) && !FLOW_REF.test(flow)) {
      sink.report(
        "GR1018",
        `the Flow cell ${JSON.stringify(flow)} of block "${block}" is not <feature>/<flow> or —.`,
        at,
      );
      continue;
    }

    if (EMPTY_CELL.test(who)) {
      sink.report(
        "GR1018",
        `the "Who sees it" cell of block "${block}" is empty; write everyone or condition names.`,
        at,
      );
      continue;
    }

    const whoItems = who
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");

    rows.push({
      block,
      flow: EMPTY_CELL.test(flow) ? null : flow,
      who: {
        everyone: whoItems.some((item) => item.toLowerCase() === "everyone"),
        conditions: whoItems.filter((item) => item.toLowerCase() !== "everyone"),
      },
      changesWith: EMPTY_CELL.test(changesWith)
        ? []
        : changesWith
            .split(";")
            .map((item) => item.trim())
            .filter((item) => item !== "")
            .map((item): WrittenChangesWith => {
              const condition = CONDITION_ITEM.exec(item);

              return condition
                ? { condition: condition[1] ?? "", text: (condition[2] ?? "").trim() }
                : { condition: null, text: item };
            }),
      at,
    });
  }

  return rows;
}

/** `grimoire/apps/<id>/README.md`. */
export function parseAppReadme(
  file: string,
  text: string,
  folder: string,
  fallbackType: "site" | "mobile",
  sink: FindingSink,
): AppReadme {
  const document = readDocument(file, text, "required", sink);
  const fields = new FrontMatterReader(document, sink);

  fields.onlyKeys(["id", "type", "root"], "app README");

  const id = fields.required("id", checks.id);

  if (id.value !== "" && id.value !== folder) {
    sink.report(
      "GR1019",
      `the app id ${JSON.stringify(id.value)} must equal its folder name ${JSON.stringify(folder)}.`,
      id.at,
    );
  }

  const root = fields.required("root", checks.folder);

  checkHeadings(document, { title: false, required: ["Conditions"], optional: [] }, sink);

  return {
    id: id.value === "" ? { value: folder, at: id.at } : id,
    type: fields.oneOf("type", ["site", "mobile"] as const, fallbackType),
    root: { value: projectFolder(root.value) ?? root.value, at: root.at },
    heading: heading(document),
    conditions: readListLines(file, findSection(document, "conditions")?.lines, "Conditions", sink),
  };
}

/** `grimoire/apps/<app>/layouts/<id>.md`. */
export function parseLayout(
  file: string,
  text: string,
  app: string,
  id: string,
  sink: FindingSink,
): WrittenLayout {
  const document = readDocument(file, text, "none", sink);

  new FrontMatterReader(document, sink).onlyKeys([], "a layout");
  checkHeadings(document, { title: false, required: ["Blocks"], optional: [] }, sink);

  const blocks = findSection(document, "blocks");

  return {
    file,
    app,
    id,
    heading: heading(document),
    blocks: blocks ? parseBlocksTable(file, blocks, sink) : [],
  };
}

/** `grimoire/apps/<app>/pages/<id>/README.md` or `screens/<id>/README.md`. */
export function parsePage(
  file: string,
  text: string,
  app: string,
  type: "page" | "screen",
  id: string,
  sink: FindingSink,
): WrittenPage {
  const document = readDocument(file, text, "required", sink);
  const fields = new FrontMatterReader(document, sink);

  fields.onlyKeys(type === "page" ? ["route", "layout"] : ["route", "screen", "layout"], type);

  const route = fields.scalar("route", { required: type === "page", check: checks.route });
  const screen =
    type === "screen" ? fields.scalar("screen", { required: false, check: checks.name }) : null;

  if (type === "screen" && fields.present && route === null && screen === null) {
    sink.report(
      "GR1003",
      'a screen needs the front matter key "route" (file-based routing) or "screen" (its name in code).',
      lineAt(file, 1),
    );
  }

  checkHeadings(
    document,
    { title: true, required: [], optional: ["Blocks", "Also reached from"] },
    sink,
  );

  const blocks = findSection(document, "blocks");
  const alsoReachedFrom: WrittenEntryPoint[] = readListLines(
    file,
    findSection(document, "also reached from")?.lines,
    "Also reached from",
    sink,
  ).map((line) => ({ kind: line.name, name: line.text, at: line.at }));

  return {
    file,
    app,
    type,
    id,
    route,
    screen,
    layout: fields.scalar("layout", { required: false, check: checks.id }),
    heading: heading(document),
    purpose: paragraphAfterTitle(document),
    blocks: blocks ? parseBlocksTable(file, blocks, sink) : [],
    alsoReachedFrom,
    blockFiles: [],
  };
}

/** `grimoire/apps/<app>/pages/<page>/blocks/<id>.md`. */
export function parseBlockFile(
  file: string,
  text: string,
  app: string,
  page: string,
  id: string,
  sink: FindingSink,
): WrittenBlockFile {
  const document = readDocument(file, text, "required", sink);
  const fields = new FrontMatterReader(document, sink);

  fields.onlyKeys(["flow"], "block file");

  return {
    file,
    app,
    page,
    id,
    flow: fields.scalar("flow", { required: true, check: checks.flowRef }),
    heading: heading(document),
    details: readListLines(file, document.body, "detail", sink),
  };
}

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createFinding } from "../codes";
import type { GrimoireFinding } from "../contracts/findings";
import type { ShowsLine } from "../contracts/shots";
import type { WrittenGrimoire } from "../contracts/written";
import { toPosixPath } from "../paths";
import { withoutBlockComments } from "./scan-proofs";

/** What a scan returns. */
export type ScanShowsResult = {
  shows: ShowsLine[];
  /** `GR4013` (wrong form, no matching `shows()` call) and `GR4014` (names no flow or criterion). */
  findings: GrimoireFinding[];
};

/** The criteria each flow has, by `<feature>/<flow>`; the scanner reports `GR4014` for a line outside it. */
export type KnownCriteria = ReadonlyMap<string, ReadonlySet<string>>;

const READ_CONCURRENCY = 32;

/** A `// @shows …` line comment on its own line; group 1 is the rest of the line. */
const SHOWS_LINE = /^\s*\/\/\s*@shows\b(.*)$/;
/** A `// @shows` comment after code on the same line. */
const TRAILING_SHOWS = /\S.*\/\/\s*@shows\b/;
/** The rest of a well-formed line: ` <feature>/<flow> AC-<n>`. */
const SHOWS_TARGET = /^\s+([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)\s+(AC-\d+)\s*$/;
/** The start of a `shows(` call: `shows(`, `await shows(`, `grimoire.shows(`. */
const SHOWS_CALL = /^(?:await\s+)?(?:[A-Za-z_$][\w$]*\s*\.\s*)?shows\s*\(/;
/** The first string argument after the first argument (`context`). */
const CALL_REF = /^[^,]*,\s*(["'`])([^"'`]*)\1/;
/** How many lines a call's first arguments may span. */
const CALL_LOOKAHEAD = 6;

/** The criteria of every flow of a written grimoire. */
export function knownCriteria(written: WrittenGrimoire): KnownCriteria {
  const known = new Map<string, Set<string>>();

  for (const feature of written.features) {
    for (const flow of feature.flows) {
      known.set(flow.ref, new Set(flow.criteria.map((criterion) => criterion.id)));
    }
  }

  return known;
}

/** Read the `@shows` lines of one test file's content. Pure. */
export function scanShowsInText(
  text: string,
  file: string,
  known?: KnownCriteria,
): ScanShowsResult {
  const testFile = toPosixPath(file);
  const code = withoutBlockComments(text.split(/\r?\n/));
  const findings: GrimoireFinding[] = [];
  const shows: ShowsLine[] = [];
  let pending: { feature: string; flow: string; criterion: string; line: number } | null = null;

  const settle = (callLine: number | null): void => {
    if (pending === null) return;

    const { feature, flow, criterion, line } = pending;
    const ref = `${feature}/${flow}`;
    const at = { file: testFile, line, column: null };

    pending = null;

    if (known !== undefined) {
      const criteria = known.get(ref);

      if (criteria === undefined || !criteria.has(criterion)) {
        findings.push(
          createFinding({
            code: "GR4014",
            message:
              criteria === undefined
                ? `"@shows ${ref} ${criterion}" names a flow that does not exist`
                : `"@shows ${ref} ${criterion}" names a criterion the flow does not have`,
            at,
            feature,
            flow: ref,
          }),
        );

        return;
      }
    }

    let call: { line: number } | null = null;

    if (callLine !== null) {
      const named = callRef(code, callLine - 1);

      if (named === `${ref} ${criterion}`) call = { line: callLine };
      else {
        findings.push(
          createFinding({
            code: "GR4013",
            message:
              named === null
                ? `"@shows ${ref} ${criterion}" is not directly above a shows() call that names "${ref} ${criterion}"`
                : `"@shows ${ref} ${criterion}" is above a shows() call that names ${JSON.stringify(named)}`,
            at,
            feature,
            flow: ref,
          }),
        );
      }
    } else {
      findings.push(
        createFinding({
          code: "GR4013",
          message: `"@shows ${ref} ${criterion}" is not directly above a shows() call`,
          at,
          feature,
          flow: ref,
        }),
      );
    }

    shows.push({ feature, flow, ref, criterion, call, at });
  };

  code.forEach((content, index) => {
    const lineNumber = index + 1;
    const match = SHOWS_LINE.exec(content);

    if (match) {
      // A second line stacked above the same call: the first has no call of its own.
      settle(null);

      const target = SHOWS_TARGET.exec(match[1] ?? "");

      if (target) {
        pending = {
          feature: target[1] ?? "",
          flow: target[2] ?? "",
          criterion: target[3] ?? "",
          line: lineNumber,
        };
      } else {
        findings.push(malformed(testFile, lineNumber, content));
      }

      return;
    }

    const trimmed = content.trim();

    if (trimmed === "" || trimmed.startsWith("//")) return;

    if (TRAILING_SHOWS.test(content)) findings.push(malformed(testFile, lineNumber, content));

    settle(SHOWS_CALL.test(trimmed) ? lineNumber : null);
  });

  settle(null);

  return { shows, findings };
}

/**
 * Read the `@shows` lines of every test file. Files that cannot be read are
 * skipped. Lines and findings come out in file order, then line order.
 *
 * @param root Absolute project root.
 * @param testFiles Project-relative test files (`BookFacts.tests`).
 * @param written The written grimoire; with it, a line naming no flow or criterion is `GR4014`.
 */
export async function scanShows(
  root: string,
  testFiles: readonly string[],
  written?: WrittenGrimoire,
): Promise<ScanShowsResult> {
  const files = [...new Set(testFiles.map(toPosixPath))].sort();
  const known = written === undefined ? undefined : knownCriteria(written);
  const results: ScanShowsResult[] = new Array(files.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const index = next++;
      const file = files[index] ?? "";

      try {
        const content = await readFile(path.join(root, ...file.split("/")), "utf8");

        // Most test files never mention it; skip the line scan for them.
        results[index] = content.includes("@shows")
          ? scanShowsInText(content, file, known)
          : { shows: [], findings: [] };
      } catch {
        results[index] = { shows: [], findings: [] };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, worker));

  return {
    shows: results.flatMap((result) => result.shows),
    findings: results.flatMap((result) => result.findings),
  };
}

/** The ref string the `shows(` call that starts at `code[start]` names, or `null`. */
function callRef(code: readonly string[], start: number): string | null {
  const joined = code
    .slice(start, start + CALL_LOOKAHEAD)
    .join("\n")
    .trim();
  const open = SHOWS_CALL.exec(joined);

  if (!open) return null;

  return CALL_REF.exec(joined.slice(open[0].length))?.[2] ?? null;
}

function malformed(file: string, line: number, content: string): GrimoireFinding {
  return createFinding({
    code: "GR4013",
    message: `"${content.trim()}" is not "// @shows <feature>/<flow> AC-<n>" on its own line`,
    at: { file, line, column: null },
  });
}

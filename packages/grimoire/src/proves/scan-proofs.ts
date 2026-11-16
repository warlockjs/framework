import { readFile } from "node:fs/promises";
import path from "node:path";
import { createFinding } from "../codes";
import type { GrimoireFinding } from "../contracts/findings";
import type { ProofLine } from "../contracts/test-results";
import { toPosixPath } from "../paths";

/** What a scan returns. */
export type ScanProofsResult = {
  proofs: ProofLine[];
  /** `GR4003` (malformed line), `GR4004` (no test under it), `GR4005` (two proofs on one test). */
  findings: GrimoireFinding[];
};

/** A `// @proves …` line comment on its own line; group 1 is the rest of the line. */
const PROOF_LINE = /^\s*\/\/\s*@proves\b(.*)$/;
/** A `// @proves` comment after code on the same line. */
const TRAILING_PROOF = /\S.*\/\/\s*@proves\b/;
/** The rest of a well-formed proof line: ` <feature>/<flow> AC-<n>`. */
const PROOF_TARGET = /^\s+([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*)\s+(AC-\d+)\s*$/;
/** `it(`, `test(`, `it.only(`, `test.each(…)(`, `it.skipIf(…)(`, `` test.each` ``… */
const TEST_CALL =
  /^(?:it|test)((?:\s*\.\s*(?:only|skip|todo|concurrent|sequential|fails|failing|each|for|skipIf|runIf|fixme|slow))*)\s*[(`]/;
/** Modifiers that take their own arguments before the test's call. */
const MODIFIER_WITH_ARGUMENTS = /\.\s*(?:each|for|skipIf|runIf)\s*$/;

type ParsedProof = {
  feature: string;
  flow: string;
  criterion: string;
  line: number;
};

/** Read the proof lines of one test file's content. Pure. */
export function scanProofsInText(text: string, file: string): ScanProofsResult {
  const testFile = toPosixPath(file);
  const lines = text.split(/\r?\n/);
  const code = withoutBlockComments(lines);
  const findings: GrimoireFinding[] = [];
  const proofs: ProofLine[] = [];
  /** Proofs waiting for the next code line, in file order. */
  let pending: ParsedProof[] = [];

  const settle = (testLine: number | null): void => {
    if (pending.length === 0) return;

    const test =
      testLine === null ? null : { name: testName(code[testLine - 1] ?? ""), line: testLine };

    for (const proof of pending) {
      const ref = `${proof.feature}/${proof.flow}`;
      const at = { file: testFile, line: proof.line, column: null };

      proofs.push({
        feature: proof.feature,
        flow: proof.flow,
        ref,
        criterion: proof.criterion,
        test,
        at,
      });

      if (!test) {
        findings.push(
          createFinding({
            code: "GR4004",
            message: `"@proves ${ref} ${proof.criterion}" is not directly above a test`,
            at,
            feature: proof.feature,
            flow: ref,
          }),
        );
      }
    }

    const distinct = [
      ...new Set(pending.map((proof) => `${proof.feature}/${proof.flow} ${proof.criterion}`)),
    ];
    const first = pending[0];

    if (test && first && distinct.length > 1) {
      findings.push(
        createFinding({
          code: "GR4005",
          message: `test ${test.name === null ? `on line ${test.line}` : JSON.stringify(test.name)} proves ${distinct.length} criteria: ${distinct.join(", ")}`,
          at: { file: testFile, line: first.line, column: null },
          feature: first.feature,
          flow: `${first.feature}/${first.flow}`,
        }),
      );
    }

    pending = [];
  };

  code.forEach((content, index) => {
    const lineNumber = index + 1;
    const proof = PROOF_LINE.exec(content);

    if (proof) {
      const target = PROOF_TARGET.exec(proof[1] ?? "");

      if (target) {
        pending.push({
          feature: target[1] ?? "",
          flow: target[2] ?? "",
          criterion: target[3] ?? "",
          line: lineNumber,
        });
      } else {
        findings.push(malformed(testFile, lineNumber, content));
      }

      return;
    }

    const trimmed = content.trim();

    if (trimmed === "" || trimmed.startsWith("//")) return;

    if (TRAILING_PROOF.test(content)) findings.push(malformed(testFile, lineNumber, content));

    settle(TEST_CALL.test(trimmed) ? lineNumber : null);
  });

  settle(null);

  return { proofs, findings };
}

/**
 * Read the proof lines of every test file. Files that cannot be read (removed
 * since the book was built) are skipped. Proofs and findings come out in
 * file order, then line order.
 *
 * @param root Absolute project root.
 * @param testFiles Project-relative test files (`BookFacts.tests`).
 */
export async function scanProofs(
  root: string,
  testFiles: readonly string[],
): Promise<ScanProofsResult> {
  const files = [...new Set(testFiles.map(toPosixPath))].sort();
  const results = await Promise.all(
    files.map(async (file) => {
      try {
        return scanProofsInText(await readFile(path.join(root, ...file.split("/")), "utf8"), file);
      } catch {
        return { proofs: [], findings: [] };
      }
    }),
  );

  return {
    proofs: results.flatMap((result) => result.proofs),
    findings: results.flatMap((result) => result.findings),
  };
}

function malformed(file: string, line: number, content: string): GrimoireFinding {
  return createFinding({
    code: "GR4003",
    message: `"${content.trim()}" is not "// @proves <feature>/<flow> AC-<n>" on its own line`,
    at: { file, line, column: null },
  });
}

/**
 * Each line with its block comments (`/* … *\/`, across lines) blanked out,
 * so a `@proves` or a test call inside a block comment is never read. Line
 * comments are kept. String contents are not considered.
 */
function withoutBlockComments(lines: readonly string[]): string[] {
  let open = false;

  return lines.map((content) => {
    let code = "";
    let rest = content;

    while (rest !== "") {
      if (open) {
        const close = rest.indexOf("*/");

        if (close === -1) return code;

        open = false;
        rest = rest.slice(close + 2);
        continue;
      }

      const block = rest.indexOf("/*");
      const line = rest.indexOf("//");

      if (block === -1 || (line !== -1 && line < block)) return code + rest;

      code += rest.slice(0, block);
      open = true;
      rest = rest.slice(block + 2);
    }

    return code;
  });
}

/**
 * The name of the test a call line declares: the first string literal of the
 * call that takes the name (after the arguments of `.each(…)`, `.skipIf(…)`…).
 * `null` when the line does not hold it (a name on the next line, a variable).
 */
function testName(content: string): string | null {
  const call = TEST_CALL.exec(content.trim());

  if (!call) return null;

  let rest = content.trim().slice(call[0].length - 1);

  if (MODIFIER_WITH_ARGUMENTS.test(call[1] ?? "")) {
    const end = rest.startsWith("`") ? closingQuote(rest, 0) : closingParen(rest);

    if (end === -1) return null;

    rest = rest.slice(end + 1).trimStart();
  }

  if (!rest.startsWith("(")) return null;

  rest = rest.slice(1).trimStart();

  const quote = rest[0];

  if (quote !== '"' && quote !== "'" && quote !== "`") return null;

  const end = closingQuote(rest, 0);

  return end === -1 ? null : rest.slice(1, end).replace(/\\(.)/g, "$1");
}

/** Index of the quote that closes the string opening at `start`, or -1. */
function closingQuote(text: string, start: number): number {
  const quote = text[start];

  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === "\\") index++;
    else if (text[index] === quote) return index;
  }

  return -1;
}

/** Index of the `)` that closes the `(` at index 0, skipping strings, or -1. */
function closingParen(text: string): number {
  let depth = 0;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (char === '"' || char === "'" || char === "`") {
      index = closingQuote(text, index);

      if (index === -1) return -1;
    } else if (char === "(" || char === "[" || char === "{") {
      depth++;
    } else if (char === ")" || char === "]" || char === "}") {
      depth--;

      if (depth === 0) return index;
    }
  }

  return -1;
}

/**
 * The code rules: four text rules over a file's content, shared by
 * `grimoire check` (whole files), the guard (added lines) and the specs.
 *
 * Escape hatch: a comment on the line or the line above reading
 * `grimoire-allow <rule>: <why>` (several rules: `grimoire-allow a, b: why`).
 * Limits: the scanner is not a parser (see `scan.ts`), and editors show no
 * squiggles for these rules.
 */
import { CODE_RULES, type CodeRuleName } from "../contracts/settings";
import { logicalCss } from "./logical-css";
import { noJsImports } from "./no-js-imports";
import { scanSource, type ScannedSource, type ScanMode } from "./scan";
import { specificErrors } from "./specific-errors";
import { typeDiscriminator } from "./type-discriminator";
import type { RuleFinding, RuleHit } from "./types";

export { phraseOf, isGenericError } from "./specific-errors";
export { scanSource, type ScannedSource, type ScanMode } from "./scan";
export type { RuleFinding, RuleHit } from "./types";

/** The finding code of each rule. */
export const RULE_CODES: Record<CodeRuleName, string> = {
  "logical-css": "GR3007",
  "specific-errors": "GR3008",
  "type-discriminator": "GR3009",
  "no-js-imports": "GR3010",
};

const CODE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const STYLE_FILE = /\.(?:css|scss|less)$/;
const LOCALE_PATH = /(?:^|[/._-])(?:locales?|lang|langs|i18n|translations?)(?:[/._-]|$)/i;
const SPEC_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
const SKIPPED_FOLDER = /(?:^|\/)(?:node_modules|dist|grimoire)\//;

/** Whether the rules read a file at all: code, style and locale JSON files, not specs, builds or `grimoire/`. */
export function isRuleFile(file: string): boolean {
  if (SKIPPED_FOLDER.test(file) || SPEC_FILE.test(file) || file.endsWith(".d.ts")) return false;

  if (file.endsWith(".json")) return LOCALE_PATH.test(file);

  return CODE_FILE.test(file) || STYLE_FILE.test(file);
}

function modeOf(file: string): ScanMode {
  if (file.endsWith(".json")) return "json";
  if (file.endsWith(".scss")) return "scss";
  if (STYLE_FILE.test(file)) return "css";

  return "code";
}

/** Lines (1-based) a `grimoire-allow` comment covers, per rule. */
function allowedLines(scanned: ScannedSource): Map<string, Set<number>> {
  const allowed = new Map<string, Set<number>>();

  for (const comment of scanned.comments) {
    const match = /grimoire-allow\s+([a-z-]+(?:\s*,\s*[a-z-]+)*)\s*:\s*\S/.exec(comment.text);

    if (!match) continue;

    for (const name of (match[1] ?? "").split(",").map((part) => part.trim())) {
      const lines = allowed.get(name) ?? new Set<number>();

      for (let line = comment.startLine; line <= comment.endLine + 1; line++) lines.add(line);

      allowed.set(name, lines);
    }
  }

  return allowed;
}

/**
 * Run the rules over one file's text. `file` decides the kind of scan (CSS,
 * JSON locale, code) and whether it is skipped. Findings come back in line
 * order; a rule's finding on a line a `grimoire-allow` comment covers is left out.
 */
export function runCodeRules(
  file: string,
  text: string,
  rules: readonly CodeRuleName[] = CODE_RULES,
): RuleFinding[] {
  if (!isRuleFile(file)) return [];

  const mode = modeOf(file);
  const scanned = scanSource(text, mode);
  const allowed = allowedLines(scanned);
  const style = mode === "css" || mode === "scss" ? "css" : "code";
  const locale = mode === "json" || LOCALE_PATH.test(file);
  const findings: RuleFinding[] = [];

  const add = (rule: CodeRuleName, hits: RuleHit[]): void => {
    for (const hit of hits) {
      if (allowed.get(rule)?.has(hit.line)) continue;

      findings.push({ ...hit, rule, code: RULE_CODES[rule] });
    }
  };

  for (const rule of rules) {
    if (rule === "logical-css" && mode !== "json") add(rule, logicalCss(scanned, style));
    else if (rule === "specific-errors" && style === "code") add(rule, specificErrors(scanned, locale));
    else if (rule === "type-discriminator" && mode === "code") add(rule, typeDiscriminator(scanned));
    else if (rule === "no-js-imports" && mode === "code") add(rule, noJsImports(scanned));
  }

  return findings.sort((left, right) => left.line - right.line || left.column - right.column);
}

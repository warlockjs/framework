/**
 * GR3007 `logical-css`: no physical directions in styles, so right-to-left
 * languages work. Reads CSS declarations, Tailwind class tokens in string
 * literals, and inline style keys.
 */
import type { ScannedSource } from "./scan";
import type { RuleHit } from "./types";

/** CSS property names that are physical, matched in CSS files and in strings (`margin-left:`). */
const PHYSICAL_PROPERTY = new RegExp(
  [
    String.raw`(?:margin|padding|scroll-margin|scroll-padding)-(?:left|right)`,
    String.raw`border-(?:left|right)(?:-(?:width|style|color))?`,
    String.raw`border-(?:top|bottom)-(?:left|right)-radius`,
  ].join("|"),
);
const PHYSICAL_PROPERTY_DECLARATION = new RegExp(
  `(?<![\\w-])(${PHYSICAL_PROPERTY.source})\\s*:`,
  "g",
);
/** `left:` and `right:` as properties (CSS files only). */
const POSITION_DECLARATION = /(?<![\w-])(left|right)\s*:(?!:)/g;
const DIRECTION_VALUE = /(?<![\w-])(text-align|float|clear)\s*:\s*(left|right)\b/g;

/** Camel-case style keys (`style={{ marginLeft: 4 }}`). */
const CAMEL_KEY =
  /(?<![\w$.])(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft(?:Width|Style|Color)?|borderRight(?:Width|Style|Color)?|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius|scrollMarginLeft|scrollMarginRight|scrollPaddingLeft|scrollPaddingRight)\s*:/g;
const CAMEL_DIRECTION_VALUE = /(?<![\w$.])(textAlign|float|clear)\s*:\s*["'`](left|right)["'`]/g;
/** `left: 0`, `right: "8px"`: a bare key counts only with a length-like value, so data objects with `left`/`right` fields pass. */
const POSITION_KEY =
  /(?<![\w$.-])(left|right)\s*:\s*(?:-?\d[\d.]*|["'`]-?[\d.]+(?:px|rem|em|%|vw|vh)?["'`]|["'`]auto["'`])/g;

const VARIANTS = String.raw`(?:(?:[a-z0-9_-]+|\[[^\]\s]+\]):)*`;
const LENGTH = String.raw`(?:\d[\d./]*|px|auto|full|\[[^\]]+\]|\([^)]+\))`;
/** A Tailwind-style class token with a physical direction. */
const CLASS_TOKEN = new RegExp(
  `^${VARIANTS}!?(?:-?m[lr]-${LENGTH}|-?p[lr]-${LENGTH}|-?(?:left|right)-${LENGTH}|text-(?:left|right)|float-(?:left|right)|border-[lr](?:-\\S+)?|rounded-(?:[lr]|t[lr]|b[lr])(?:-\\S+)?|scroll-m[lr]-${LENGTH}|scroll-p[lr]-${LENGTH})!?$`,
);

const LOGICAL: Record<string, string> = {
  "margin-left": "margin-inline-start",
  "margin-right": "margin-inline-end",
  "padding-left": "padding-inline-start",
  "padding-right": "padding-inline-end",
  left: "inset-inline-start",
  right: "inset-inline-end",
};

function suggestion(text: string): string {
  const property = text.toLowerCase().replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const logical = LOGICAL[property];

  return logical ? ` (use ${logical})` : "";
}

function classSuggestion(token: string): string {
  const base = token.slice(token.lastIndexOf(":") + 1).replace(/^!/, "");

  if (/^-?m[lr]-/.test(base))
    return base.replace(/m([lr])-/, (_all, side: string) => `m${side === "l" ? "s" : "e"}-`);
  if (/^-?p[lr]-/.test(base))
    return base.replace(/p([lr])-/, (_all, side: string) => `p${side === "l" ? "s" : "e"}-`);
  if (/^-?(?:left|right)-/.test(base))
    return base.replace(
      /(left|right)-/,
      (_all, side: string) => `${side === "left" ? "start" : "end"}-`,
    );
  if (/^text-/.test(base))
    return base.replace(/left|right/, (side) => (side === "left" ? "start" : "end"));
  if (/^float-/.test(base))
    return base.replace(/left|right/, (side) => (side === "left" ? "start" : "end"));
  if (/^border-[lr]/.test(base))
    return base.replace(
      /^border-([lr])/,
      (_all, side: string) => `border-${side === "l" ? "s" : "e"}`,
    );
  if (/^rounded-[lr]/.test(base))
    return base.replace(
      /^rounded-([lr])/,
      (_all, side: string) => `rounded-${side === "l" ? "s" : "e"}`,
    );

  return "";
}

function hit(line: number, column: number, found: string, hint: string): RuleHit {
  return {
    line,
    column,
    message: `${JSON.stringify(found)} is a physical direction${hint}; right-to-left layouts need the logical form`,
  };
}

function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;

  return { line, column: offset - (before.lastIndexOf("\n") + 1) + 1 };
}

function eachMatch(text: string, pattern: RegExp, visit: (match: RegExpExecArray) => void): void {
  for (const match of text.matchAll(pattern)) visit(match);
}

/** The hits of the rule in one scanned file. `style` says whether the file is CSS (`css`) or code. */
export function logicalCss(scanned: ScannedSource, style: "css" | "code"): RuleHit[] {
  const hits: RuleHit[] = [];
  const declarations = style === "css" ? scanned.stripped : null;

  if (declarations !== null) {
    eachMatch(declarations, PHYSICAL_PROPERTY_DECLARATION, (match) => {
      const place = lineColumn(declarations, match.index ?? 0);

      hits.push(hit(place.line, place.column, match[1] ?? "", suggestion(match[1] ?? "")));
    });
    eachMatch(declarations, POSITION_DECLARATION, (match) => {
      const place = lineColumn(declarations, match.index ?? 0);

      hits.push(hit(place.line, place.column, match[1] ?? "", suggestion(match[1] ?? "")));
    });
    eachMatch(declarations, DIRECTION_VALUE, (match) => {
      const place = lineColumn(declarations, match.index ?? 0);
      const side = match[2] === "left" ? "start" : "end";

      hits.push(
        hit(place.line, place.column, `${match[1]}: ${match[2]}`, ` (use ${match[1]}: ${side})`),
      );
    });

    return hits;
  }

  for (const part of scanned.strings) {
    // CSS written inside a string (`style="margin-left: 4px"`, a css`…` template).
    for (const match of part.text.matchAll(PHYSICAL_PROPERTY_DECLARATION)) {
      hits.push(hit(part.line, part.column, match[1] ?? "", suggestion(match[1] ?? "")));
    }

    for (const match of part.text.matchAll(DIRECTION_VALUE)) {
      const side = match[2] === "left" ? "start" : "end";

      hits.push(
        hit(part.line, part.column, `${match[1]}: ${match[2]}`, ` (use ${match[1]}: ${side})`),
      );
    }

    for (const token of part.text.split(/\s+/)) {
      if (token !== "" && CLASS_TOKEN.test(token)) {
        const fix = classSuggestion(token);

        hits.push(hit(part.line, part.column, token, fix === "" ? "" : ` (use ${fix})`));
      }
    }
  }

  // Inline style keys live in code, not in strings.
  const code = scanned.bare;

  eachMatch(code, CAMEL_KEY, (match) => {
    const place = lineColumn(code, match.index ?? 0);

    hits.push(hit(place.line, place.column, match[1] ?? "", ""));
  });
  eachMatch(scanned.stripped, CAMEL_DIRECTION_VALUE, (match) => {
    const place = lineColumn(scanned.stripped, match.index ?? 0);
    const side = match[2] === "left" ? "start" : "end";

    hits.push(hit(place.line, place.column, `${match[1]}: "${match[2]}"`, ` (use "${side}")`));
  });
  eachMatch(scanned.stripped, POSITION_KEY, (match) => {
    const place = lineColumn(scanned.stripped, match.index ?? 0);

    hits.push(hit(place.line, place.column, match[1] ?? "", suggestion(match[1] ?? "")));
  });

  return hits;
}

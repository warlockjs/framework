/**
 * GR3008 `specific-errors`: a user-facing error says what failed and what to
 * do next. A string whose whole text is a generic phrase is flagged.
 */
import type { ScannedSource } from "./scan";
import type { RuleHit } from "./types";

/** Generic phrases flagged anywhere (lower-case, no punctuation). */
const GENERIC_PHRASES: ReadonlySet<string> = new Set([
  "something went wrong",
  "something wrong happened",
  "an error occurred",
  "an error has occurred",
  "an unexpected error occurred",
  "an unexpected error has occurred",
  "unknown error",
  "unexpected error",
  "an unknown error occurred",
  "حدث خطأ ما",
  "حدث خطأ",
  "حدث خطأ غير متوقع",
  "خطأ غير معروف",
]);

/** Short words flagged only as a locale value (`"error": "Error"`): in code they are log levels and event names. */
const GENERIC_WORDS: ReadonlySet<string> = new Set(["oops", "error", "errors"]);

const TRAILING_ADVICE =
  /[\s,.;:!-]*(?:please\s+)?(?:try\s+again(?:\s+later)?|حاول\s+مرة\s+أخرى(?:\s+لاحقا)?|يرجى\s+المحاولة\s+مرة\s+أخرى|حاول\s+مجددا)\s*[.!]*$/u;

/** The phrase of a string: trimmed, punctuation and "please try again" removed, lower-case. */
export function phraseOf(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(TRAILING_ADVICE, "")
    .replace(/^[\s"'`.,;:!?\-()[\]]+|[\s"'`.,;:!?\-()[\]]+$/gu, "")
    .replace(/\s+/g, " ");
}

/** Whether a whole string is a generic error text. `locale` also flags the short words. */
export function isGenericError(text: string, locale: boolean): boolean {
  const phrase = phraseOf(text);

  if (phrase === "") return false;

  return GENERIC_PHRASES.has(phrase) || (locale && GENERIC_WORDS.has(phrase));
}

/** The hits of the rule. `locale` is `true` for locale files (JSON or TS), where keys are skipped and the short words count. */
export function specificErrors(scanned: ScannedSource, locale: boolean): RuleHit[] {
  const hits: RuleHit[] = [];

  for (const part of scanned.strings) {
    if (part.isKey) continue;

    if (isGenericError(part.text, locale)) {
      hits.push({
        line: part.line,
        column: part.column,
        message: `${JSON.stringify(part.text)} says nothing about what failed or what to do next`,
      });
    }
  }

  return hits;
}

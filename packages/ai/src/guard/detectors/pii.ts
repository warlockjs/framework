import type {
  GuardrailMatch,
  GuardrailVerdict,
  PiiCategory,
  PiiDetectorOptions,
  SyncGuardrailDetector,
} from "../contracts";

/** Detector name, used as the namespace prefix on every {@link GuardrailMatch.rule}. */
const DETECTOR_NAME = "pii";

/** Placeholder substituted for a matched span when the caller supplies no `mask`. */
const DEFAULT_MASK = "[REDACTED]";

/**
 * The built-in PII category regexes. Each is linear (anchored alternations,
 * no nested quantifiers) so it is safe against catastrophic backtracking on
 * adversarial input. All carry the global flag so a single pass over the
 * text yields every occurrence; `lastIndex` is reset per use so a shared
 * instance never leaks state across calls.
 *
 * - `ssn`         — US Social Security number, `123-45-6789` / `123 45 6789`.
 * - `email`       — a pragmatic address shape, not full RFC 5322.
 * - `phone`       — North-American style, optional `+1`, separators, parens.
 * - `credit-card` — 13–16 digit runs, optional space / hyphen grouping.
 * - `ipv4`        — four dotted octets (loosely; out-of-range octets still match).
 *
 * `email` is not scanned with this table: a single address regex restarts
 * inside every run of local-part characters, which costs quadratic time on
 * input such as `"a.".repeat(n)`. {@link scanEmails} finds the same matches
 * in one forward pass anchored on each `@`.
 */
const CATEGORY_PATTERNS: Record<Exclude<PiiCategory, "email">, RegExp> = {
  ssn: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g,
  phone: /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  "credit-card": /\b(?:\d[ -]?){13,16}\b/g,
  ipv4: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
};

/** Every built-in category, in a stable scan order. */
const ALL_CATEGORIES: readonly PiiCategory[] = ["ssn", "email", "phone", "credit-card", "ipv4"];

/**
 * A raw hit located inside the inspected text, before it is folded into a
 * {@link GuardrailMatch}. `label` is the category (built-in) or
 * `"dictionary"` (an extra term); `start` / `end` are inclusive offsets.
 */
interface RawHit {
  readonly label: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Escape a string for safe interpolation into a `RegExp` source, so an
 * extra dictionary term containing regex metacharacters (`.`, `+`, `(`, …)
 * matches literally rather than as a pattern.
 */
function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the `{label}` mask for a hit. The template's `{label}` token is
 * substituted with the hit's category; a template without the token is used
 * verbatim. Falls back to {@link DEFAULT_MASK} when no template is given.
 */
function applyMask(template: string | undefined, label: string): string {
  if (template === undefined) {
    return DEFAULT_MASK;
  }

  return template.replace(/\{label\}/g, label);
}

/**
 * Collect every built-in-category hit in `text` for the requested
 * categories, in document order per category.
 */
function scanCategories(text: string, categories: readonly PiiCategory[]): RawHit[] {
  const hits: RawHit[] = [];

  for (const category of categories) {
    if (category === "email") {
      // One push per hit: spreading a large hit list into `push` overflows
      // the call stack, and a throwing detector fails open.
      for (const hit of scanEmails(text)) {
        hits.push(hit);
      }

      continue;
    }

    const pattern = CATEGORY_PATTERNS[category];
    pattern.lastIndex = 0;

    let match = pattern.exec(text);

    while (match !== null) {
      hits.push({
        label: category,
        start: match.index,
        end: match.index + match[0].length - 1,
      });

      // Guard the zero-length-match case so `exec` can never spin forever.
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }

      match = pattern.exec(text);
    }
  }

  return hits;
}

/**
 * The part of an address after its `@`: domain characters, a dot, a 2+ letter
 * top-level label and a word boundary. Run sticky at `@ + 1`; its cost is
 * linear in the domain run that follows that one `@`.
 */
const EMAIL_DOMAIN = /[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/y;

/** Whether `code` is an address local-part character: `[A-Za-z0-9._%+-]`. */
function isLocalPartChar(code: number): boolean {
  return (
    isWordChar(code) ||
    code === 46 /* . */ ||
    code === 37 /* % */ ||
    code === 43 /* + */ ||
    code === 45 /* - */
  );
}

/** Whether `code` is a regex word character: `[A-Za-z0-9_]`. */
function isWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}

/** Whether a regex `\b` holds at `index` (a word / non-word transition). */
function isWordBoundary(text: string, index: number): boolean {
  const before = index > 0 && isWordChar(text.charCodeAt(index - 1));
  const after = index < text.length && isWordChar(text.charCodeAt(index));

  return before !== after;
}

/**
 * Find email addresses in one forward pass. Returns exactly the matches of
 * `/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g`, in order, but
 * anchors on each `@`: the local part is the run of local-part characters
 * that ends at the `@` (starting at its first word boundary, never before the
 * end of the previous match), and the domain is matched once from the `@`.
 * Every character is visited a bounded number of times, so adversarial
 * input cannot make the scan quadratic.
 */
function scanEmails(text: string): RawHit[] {
  const hits: RawHit[] = [];
  let searchFrom = 0;
  let at = text.indexOf("@");

  while (at !== -1) {
    let runStart = at;

    while (runStart > searchFrom && isLocalPartChar(text.charCodeAt(runStart - 1))) {
      runStart -= 1;
    }

    let start = -1;

    for (let index = runStart; index < at; index += 1) {
      if (isWordBoundary(text, index)) {
        start = index;
        break;
      }
    }

    if (start !== -1) {
      EMAIL_DOMAIN.lastIndex = at + 1;
      const domain = EMAIL_DOMAIN.exec(text);

      if (domain !== null) {
        const end = at + 1 + domain[0].length;

        hits.push({ label: "email", start, end: end - 1 });
        searchFrom = end;
      }
    }

    at = text.indexOf("@", Math.max(at + 1, searchFrom));
  }

  return hits;
}

/**
 * Collect every occurrence of each extra dictionary term in `text`,
 * case-insensitively, as `"dictionary"`-labelled hits.
 */
function scanDictionary(text: string, dictionary: readonly string[]): RawHit[] {
  const hits: RawHit[] = [];

  for (const term of dictionary) {
    if (term.length === 0) {
      continue;
    }

    const pattern = new RegExp(escapeRegExp(term), "gi");
    let match = pattern.exec(text);

    while (match !== null) {
      hits.push({
        label: "dictionary",
        start: match.index,
        end: match.index + match[0].length - 1,
      });

      match = pattern.exec(text);
    }
  }

  return hits;
}

/**
 * Sort hits by start offset, then drop any hit fully contained in (or
 * duplicating) an already-kept span. Different category regexes can overlap
 * on the same characters (e.g. a credit-card run inside a phone-shaped
 * span); keeping the earliest, widest span makes redaction deterministic
 * and avoids masking a sub-span twice.
 *
 * Kept spans are disjoint and sorted, so the last kept span has the largest
 * end: a hit overlaps a kept span exactly when it overlaps that last one.
 * Comparing against it alone keeps the pass O(n log n).
 */
function dedupeHits(hits: RawHit[]): RawHit[] {
  const sorted = [...hits].sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }

    // Same start: keep the wider span first so the narrower one is absorbed.
    return b.end - a.end;
  });

  const kept: RawHit[] = [];
  let lastEnd = -1;

  for (const hit of sorted) {
    if (hit.start > lastEnd) {
      kept.push(hit);
      lastEnd = hit.end;
    }
  }

  return kept;
}

/**
 * Rewrite `text`, replacing every kept hit's span with its mask. The hits
 * are disjoint, so one forward pass collects the untouched slices and masks
 * and joins them once.
 */
function redactText(text: string, hits: RawHit[], mask: string | undefined): string {
  const ordered = [...hits].sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;

  for (const hit of ordered) {
    parts.push(text.slice(cursor, hit.start), applyMask(mask, hit.label));
    cursor = hit.end + 1;
  }

  parts.push(text.slice(cursor));

  return parts.join("");
}

/** Fold a {@link RawHit} into the public {@link GuardrailMatch} shape. */
function toMatch(hit: RawHit): GuardrailMatch {
  return {
    rule: `${DETECTOR_NAME}.${hit.label}`,
    span: [hit.start, hit.end],
    label: hit.label,
  };
}

/**
 * Build the built-in **PII detector** (`ai.guardrail.pii`) — a zero-runtime-
 * dependency {@link GuardrailDetector} that scans text for personally
 * identifiable information via a curated set of linear regexes plus an
 * optional exact-string dictionary.
 *
 * Categories (`detect`, default: all): `ssn`, `email`, `phone`,
 * `credit-card`, `ipv4`. `dictionary` adds extra exact terms matched
 * case-insensitively as literal strings (regex metacharacters escaped).
 *
 * On a hit the verdict follows `onMatch` (default `"redact"`):
 *
 * - **`redact`** — every matched span is replaced by the `mask` template
 *   (`{label}` → the matched category, default `"[REDACTED]"`) and the
 *   rewritten text is returned for the factory to substitute. Output and
 *   tool phases honour the rewrite; on the input phase the factory treats a
 *   `redact` verdict as a `block` (the core `trip.before` hook can only
 *   short-circuit, not rewrite-and-continue — see {@link PiiDetectorOptions}).
 * - **`block`** — a hard stop carrying the matches.
 * - **`flag`**  — the content passes but the matches are recorded.
 *
 * Clean text returns `{ type: "allow" }`.
 *
 * @example
 * ai.guardrail({ output: [ai.guardrail.pii()] }); // redact, default mask
 *
 * @example
 * ai.guardrail.pii({
 *   detect: ["ssn", "credit-card"],
 *   onMatch: "redact",
 *   mask: "[PII:{label}]",
 *   dictionary: ["Project Aurora"],
 * });
 */
export function pii(options: PiiDetectorOptions = {}): SyncGuardrailDetector {
  const categories = options.detect ?? ALL_CATEGORIES;
  const onMatch = options.onMatch ?? "redact";
  const dictionary = options.dictionary ?? [];

  return {
    name: DETECTOR_NAME,
    check(text: string): GuardrailVerdict {
      const rawHits = [...scanCategories(text, categories), ...scanDictionary(text, dictionary)];

      if (rawHits.length === 0) {
        return { type: "allow" };
      }

      const hits = dedupeHits(rawHits);
      const matches = hits.map(toMatch);
      const labels = [...new Set(hits.map((hit) => hit.label))].join(", ");

      if (onMatch === "block") {
        return {
          type: "block",
          reason: `PII detected: ${labels}.`,
          matches,
        };
      }

      if (onMatch === "flag") {
        return {
          type: "flag",
          reason: `PII detected: ${labels}.`,
          matches,
        };
      }

      return {
        type: "redact",
        text: redactText(text, hits, options.mask),
        reason: `Redacted PII: ${labels}.`,
        matches,
      };
    },
  };
}

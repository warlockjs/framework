/**
 * How `edit_file` / `multi_edit` find `oldString` in a file.
 *
 * - `"exact"` — the text must appear byte for byte.
 * - `"tiered"` (default) — try the exact text first, then fall back, in order,
 *   to the same text with line endings normalised, with look-alike Unicode
 *   punctuation folded (curly quotes, dashes, non-breaking spaces), and
 *   finally line by line ignoring trailing whitespace. The first tier that
 *   finds the text wins.
 */
export type WorkspaceEditMatching = "exact" | "tiered";

/** The tier that located an edit's text. */
export type WorkspaceEditMatchTier = "exact" | "unicode" | "whitespace";

/** Half-open character range `[start, end)` in the original file content. */
export interface EditRange {
  start: number;
  end: number;
}

/** Where `oldString` was found. */
export interface EditLocation {
  /** The tier that matched; `null` when none did. */
  tier: WorkspaceEditMatchTier | null;
  /** Non-overlapping ranges in the original content, ascending. */
  ranges: EditRange[];
  /** True when the match went through the line-ending-normalised view. */
  viaView: boolean;
}

/** Most lines of file text a miss hint shows. */
export const MAX_HINT_LINES = 12;
/** Most characters of one line a miss hint shows. */
export const MAX_HINT_LINE_CHARS = 200;

const FOLD_MAP: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
};

/** Fold look-alike characters one for one, so string indexes stay aligned. */
export function foldUnicode(value: string): string {
  let out = "";

  for (const char of value) {
    out += FOLD_MAP[char] ?? char;
  }

  return out;
}

/** Every non-overlapping occurrence of `needle` in `haystack`. */
function findAll(haystack: string, needle: string): EditRange[] {
  const ranges: EditRange[] = [];

  if (needle === "") {
    return ranges;
  }

  let from = 0;

  for (;;) {
    const index = haystack.indexOf(needle, from);

    if (index === -1) {
      return ranges;
    }

    ranges.push({ start: index, end: index + needle.length });
    from = index + needle.length;
  }
}

/** The file's dominant line ending. */
export function detectEol(content: string): "\n" | "\r\n" {
  const crlf = content.split("\r\n").length - 1;
  const lf = content.split("\n").length - 1 - crlf;

  return crlf > lf ? "\r\n" : "\n";
}

/** Convert any line endings in `text` to `eol`. */
export function withEol(text: string, eol: "\n" | "\r\n"): string {
  const normalised = text.replace(/\r\n/g, "\n");

  return eol === "\n" ? normalised : normalised.replace(/\n/g, "\r\n");
}

/** An LF view of `content` plus the original index of each view character. */
function lfView(content: string): { view: string; map: number[] | null } {
  if (!content.includes("\r\n")) {
    return { view: content, map: null };
  }

  let view = "";
  const map: number[] = [];

  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\r" && content[index + 1] === "\n") {
      continue;
    }

    // A `\n` that came from `\r\n` points at the `\r`, so a range starting
    // on it takes the whole line break.
    map.push(content[index] === "\n" && content[index - 1] === "\r" ? index - 1 : index);
    view += content[index];
  }

  map.push(content.length);

  return { view, map };
}

/** Line-based search ignoring trailing whitespace, on already folded text. */
function findByLines(view: string, needle: string): EditRange[] {
  const needleLines = needle.split("\n");
  const endsWithBreak = needleLines.length > 1 && needleLines[needleLines.length - 1] === "";

  if (endsWithBreak) {
    needleLines.pop();
  }

  const wanted = needleLines.map((line) => line.trimEnd());

  if (wanted.every((line) => line === "")) {
    return [];
  }

  const lines = view.split("\n");
  const starts: number[] = [];
  let offset = 0;

  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }

  const ranges: EditRange[] = [];

  for (let index = 0; index + wanted.length <= lines.length; ) {
    let same = true;

    for (let k = 0; k < wanted.length; k++) {
      if ((lines[index + k] ?? "").trimEnd() !== wanted[k]) {
        same = false;

        break;
      }
    }

    if (!same) {
      index++;

      continue;
    }

    const last = index + wanted.length - 1;
    let end = (starts[last] ?? 0) + (lines[last] ?? "").length;

    if (endsWithBreak && view[end] === "\n") {
      end++;
    }

    ranges.push({ start: starts[index] ?? 0, end });
    index += wanted.length;
  }

  return ranges;
}

/**
 * Find `oldString` in `content`. `"exact"` only looks for the text as given;
 * `"tiered"` walks the tiers described on {@link WorkspaceEditMatching} and
 * stops at the first one with a match. The ranges are always in the original
 * content, whatever view found them.
 */
export function locateEdit(
  content: string,
  oldString: string,
  matching: WorkspaceEditMatching,
): EditLocation {
  const exact = findAll(content, oldString);

  if (exact.length > 0 || matching === "exact") {
    return { tier: exact.length > 0 ? "exact" : null, ranges: exact, viaView: false };
  }

  const { view, map } = lfView(content);
  const needle = oldString.replace(/\r\n/g, "\n");
  const back = (ranges: EditRange[]): EditRange[] =>
    map === null
      ? ranges
      : ranges.map((range) => ({
          start: map[range.start] ?? content.length,
          end: map[range.end] ?? content.length,
        }));

  if (map !== null || needle !== oldString) {
    const plain = findAll(view, needle);

    if (plain.length > 0) {
      return { tier: "exact", ranges: back(plain), viaView: true };
    }
  }

  const foldedView = foldUnicode(view);
  const foldedNeedle = foldUnicode(needle);
  const folded = findAll(foldedView, foldedNeedle);

  if (folded.length > 0) {
    return { tier: "unicode", ranges: back(folded), viaView: true };
  }

  const lined = findByLines(foldedView, foldedNeedle);

  if (lined.length > 0) {
    return { tier: "whitespace", ranges: back(lined), viaView: true };
  }

  return { tier: null, ranges: [], viaView: false };
}

function clipLine(line: string): string {
  const flat = line.replace(/\r$/, "");

  return flat.length > MAX_HINT_LINE_CHARS ? `${flat.slice(0, MAX_HINT_LINE_CHARS)}…` : flat;
}

function tokens(line: string): Set<string> {
  return new Set(line.match(/[A-Za-z0-9_$]+/g) ?? []);
}

function similarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let shared = 0;

  for (const token of left) {
    if (right.has(token)) {
      shared++;
    }
  }

  return shared / (left.size + right.size - shared);
}

/**
 * Explain a miss: either `newString` is already in the file (the edit was
 * probably applied), or the file text closest to `oldString`, at most
 * {@link MAX_HINT_LINES} lines of {@link MAX_HINT_LINE_CHARS} characters.
 * `undefined` when nothing is close.
 */
export function describeMiss(
  content: string,
  oldString: string,
  newString: string,
  maxLines: number = MAX_HINT_LINES,
): string | undefined {
  if (maxLines <= 0) {
    return undefined;
  }

  const lines = content.split("\n");
  const present = newString.trim() === "" ? -1 : content.indexOf(newString);

  if (present !== -1 && newString !== oldString) {
    const line = content.slice(0, present).split("\n").length;

    return `newString already present in the file (line ${line}); the edit may already have been applied.`;
  }

  const fileTokens = lines.map((line) => tokens(line));
  const wanted = oldString.split("\n");
  let best = { score: 0, fileLine: -1, offset: 0 };

  wanted.forEach((text, offset) => {
    const own = tokens(text);

    fileTokens.forEach((candidate, fileLine) => {
      const score = similarity(own, candidate);

      if (score > best.score) {
        best = { score, fileLine, offset };
      }
    });
  });

  if (best.fileLine === -1 || best.score < 0.5) {
    return undefined;
  }

  const first = Math.max(0, best.fileLine - best.offset);
  const count = Math.min(maxLines, MAX_HINT_LINES, Math.max(1, wanted.length));
  const shown = lines
    .slice(first, first + count)
    .map((line, index) => `${first + index + 1}: ${clipLine(line)}`);

  return `Closest text in the file (lines ${first + 1}-${first + shown.length}):\n${shown.join("\n")}`;
}

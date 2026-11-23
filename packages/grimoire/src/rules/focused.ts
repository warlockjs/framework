/**
 * GR4011 / GR4012: tests focused with `.only` or skipped with `.skip`.
 * `.skipIf(...)` and `.todo` are not flagged; comments and strings are ignored.
 */
import { scanSource } from "./scan";

/** One focused or skipped test call. */
export type FocusedHit = { line: number; type: "only" | "skip"; call: string };

const FOCUSED = /\b(describe|it|test|suite)((?:\.(?:concurrent|sequential))?)\.(only|skip)\b/g;

/** Find `.only` and `.skip` calls in a test file's text. */
export function findFocusedTests(text: string): FocusedHit[] {
  const { bare } = scanSource(text, "code");
  const hits: FocusedHit[] = [];

  for (const match of bare.matchAll(FOCUSED)) {
    const offset = match.index ?? 0;

    hits.push({
      line: bare.slice(0, offset).split("\n").length,
      type: match[3] === "only" ? "only" : "skip",
      call: match[0],
    });
  }

  return hits;
}

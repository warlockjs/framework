/**
 * Counting a test file's assertions: `expect(`, `expect.soft(`,
 * `expect.poll(`, `assert(`, `assert.<word>(` and `.should(`. Comments and
 * strings are skipped by the source scanner. Limit: an assertion helper
 * of your own (`checkTotals(…)`) is not counted.
 */
import { scanSource } from "../rules/scan";

const ASSERTION = /(?<![\w$.])(?:expect(?:\.(?:soft|poll))?|assert(?:\.\w+)?)\s*\(|\.should\s*\(/g;

/** How many assertions the text holds. */
export function countAssertions(text: string): number {
  return [...scanSource(text, "code").bare.matchAll(ASSERTION)].length;
}

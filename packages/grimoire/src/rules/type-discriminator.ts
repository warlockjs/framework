/**
 * GR3009 `type-discriminator`: the field that tells variants apart is named
 * `type`, never `kind`. Flags `kind` as a property key whose value starts
 * with a string literal (`kind: "a"`, `kind?: "a" | "b"`).
 */
import type { ScannedSource } from "./scan";
import type { RuleHit } from "./types";

const KIND_KEY = /(?<![\w$])kind\s*\??\s*:\s*["'`]/g;
const MODIFIERS = /(?:readonly|public|private|protected|static)\s+$/;

/** The hits of the rule. */
export function typeDiscriminator(scanned: ScannedSource): RuleHit[] {
  const hits: RuleHit[] = [];
  const code = scanned.bare;

  for (const match of code.matchAll(KIND_KEY)) {
    const offset = match.index ?? 0;
    let before = code.slice(0, offset).replace(MODIFIERS, "");

    before = before.replace(/\s+$/, "");

    const previous = before.slice(-1);

    // A property key follows `{`, `,`, `;`, `|`, `&`, `(` or starts the text; `a ? kind : "x"` and `a.kind: …` do not.
    if (previous !== "" && !"{,;|&(<[".includes(previous)) continue;

    const before2 = code.slice(0, offset);
    const line = before2.split("\n").length;

    hits.push({
      line,
      column: offset - (before2.lastIndexOf("\n") + 1) + 1,
      message: 'the discriminator field is named "kind"; name it "type"',
    });
  }

  return hits;
}

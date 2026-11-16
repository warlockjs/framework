/**
 * Who owns each source file (owned by T-128). Rules in `FileOwnership`.
 */
import type { BookFacts } from "../contracts/adapter";
import type { Ownership } from "../contracts/bookmap";
import type { WrittenGrimoire } from "../contracts/written";

/** Owner, conflicts and borrowers of every code file in `facts`. Pure. */
export function resolveOwnership(written: WrittenGrimoire, facts: BookFacts): Ownership {
  void written;
  void facts;
  throw new Error("not implemented");
}

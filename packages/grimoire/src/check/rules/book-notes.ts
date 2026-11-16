/**
 * GR8003: notes about the book the check read.
 */
import { createFinding } from "../../codes";
import type { GrimoireFinding } from "../../contracts/findings";
import type { GrimoireSnapshot } from "../../contracts/snapshot";

/** GR8003: route steps were checked against cached route facts whose inputs changed. */
export function checkBookNotes(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  if (snapshot.routes !== "stale") return [];

  return [
    createFinding({
      code: "GR8003",
      message: "route facts are stale; route steps were checked against the cached routes",
    }),
  ];
}

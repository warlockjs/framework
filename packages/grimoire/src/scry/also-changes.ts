/**
 * The files that usually change with the top hits of a search: what the hits'
 * files import and what imports them inside the same owning feature (the same
 * module when the file has no owner), and the tests that import them or prove
 * the hits' flows. Pure: reads the snapshot only.
 */
import type { ScryAlsoChange, ScryHit } from "../contracts/scry";
import type { GrimoireSnapshot } from "../contracts/snapshot";

/** How many top hits that map to files bring files in. */
const TOP_HITS = 3;

/** The most files listed. */
export const ALSO_CHANGES_LIMIT = 10;

const REASON_ORDER: ScryAlsoChange["reason"][] = ["step", "imports", "imported-by", "test"];

const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/** The files a hit stands for: a file, the file of an export, page or screen, a flow's step entries, a route's handler. */
function filesOfHit(snapshot: GrimoireSnapshot, hit: ScryHit): string[] {
  const facts = snapshot.book.facts;

  switch (hit.type) {
    case "file":
      return [hit.id];
    case "export":
      return [hit.id.split("#")[0] ?? hit.id];
    case "page":
    case "screen":
    case "mail":
    case "job":
      return hit.detail === null ? [] : [hit.detail];
    case "flow": {
      const bookmap = snapshot.collected?.flows?.[hit.id];

      return [...new Set((bookmap?.steps ?? []).flatMap((step) => step.entries))].sort(byText);
    }
    case "route": {
      const found = (facts.routes ?? []).find(
        (route) => `${route.method} ${route.path}` === hit.id,
      );

      return found?.handlerFile == null ? [] : [found.handlerFile];
    }
    default:
      return [];
  }
}

/** Files that prove the flow of a flow hit. */
function provingTests(snapshot: GrimoireSnapshot, hit: ScryHit): string[] {
  if (hit.type !== "flow") return [];

  const bookmap = snapshot.collected?.flows?.[hit.id];

  return [
    ...new Set((bookmap?.criteria ?? []).flatMap((item) => item.tests.map((test) => test.file))),
  ];
}

/**
 * The files that change with the top hits, most shared first (then step, imports,
 * imported-by, test, then path), at most ten, none of them a hit's own file.
 * `next` is the impact command for the first file a top hit maps to.
 */
export function alsoChangesOf(
  snapshot: GrimoireSnapshot,
  hits: readonly ScryHit[],
): { alsoChanges: ScryAlsoChange[]; next: string | undefined } {
  const files = new Map(snapshot.book.facts.files.map((file) => [file.file, file]));
  const owner = (file: string): string | null => snapshot.ownership?.files?.[file]?.owner ?? null;
  const sameGroup = (left: string, right: string): boolean => {
    const leftOwner = owner(left);

    if (leftOwner !== null) return leftOwner === owner(right);

    const leftFile = files.get(left);

    return (
      owner(right) === null &&
      leftFile !== undefined &&
      leftFile.module === files.get(right)?.module
    );
  };
  const isSpec = (file: string): boolean => files.get(file)?.type === "spec";

  const top = hits
    .map((hit) => ({ hit, seeds: filesOfHit(snapshot, hit).filter((file) => files.has(file)) }))
    .filter((item) => item.seeds.length > 0)
    .slice(0, TOP_HITS);
  // A hit's own file is already in the answer; the step files of a flow hit are not.
  const hitFiles = new Set(
    hits.filter((hit) => hit.type !== "flow").flatMap((hit) => filesOfHit(snapshot, hit)),
  );
  const found = new Map<string, { reason: ScryAlsoChange["reason"]; via: Set<string> }>();
  const add = (file: string, reason: ScryAlsoChange["reason"], via: string): void => {
    if (hitFiles.has(file)) return;

    const existing = found.get(file);

    if (existing === undefined) {
      found.set(file, { reason, via: new Set([via]) });

      return;
    }

    existing.via.add(via);

    if (REASON_ORDER.indexOf(reason) < REASON_ORDER.indexOf(existing.reason))
      existing.reason = reason;
  };

  for (const { hit, seeds } of top) {
    if (hit.type === "flow") {
      for (const seed of seeds) add(seed, "step", hit.id);
    }

    for (const seed of seeds) {
      const book = files.get(seed);

      if (book === undefined) continue;

      for (const entry of book.imports) {
        if (entry.file === null || isSpec(entry.file) || !files.has(entry.file)) continue;
        if (sameGroup(seed, entry.file)) add(entry.file, "imported-by", hit.id);
      }

      for (const importer of book.importedBy) {
        if (!files.has(importer)) continue;
        if (isSpec(importer)) add(importer, "test", hit.id);
        else if (sameGroup(seed, importer)) add(importer, "imports", hit.id);
      }
    }

    for (const test of provingTests(snapshot, hit)) add(test, "test", hit.id);
  }

  const alsoChanges = [...found]
    .map(([file, { reason, via }]) => ({ file, reason, via: [...via] }))
    .sort(
      (left, right) =>
        right.via.length - left.via.length ||
        REASON_ORDER.indexOf(left.reason) - REASON_ORDER.indexOf(right.reason) ||
        byText(left.file, right.file),
    )
    .slice(0, ALSO_CHANGES_LIMIT);
  const first = top[0]?.seeds[0];

  return { alsoChanges, next: first === undefined ? undefined : `warlock scry --impact ${first}` };
}

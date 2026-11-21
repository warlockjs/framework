/**
 * The read-only open: `warlock scry` and the MCP tools. It loads the book the
 * last `warlock grimoire build` left on disk and never rebuilds or writes it.
 *
 * What it reads: `manifest.json` and `.cache/facts.json` (the book) and
 * `.cache/derived.json` (owners, apps, proofs, results, book maps,
 * annotations, the parsed written files). What it computes: one change check,
 * the `buildBook` scan of the source roots and tests (no adapter `files()`
 * call) and a `stat` of the written files. Anything that moved is reported in
 * `snapshot.behind`; the answer is still the stored one.
 */
import { checkBook, grimoireVersion } from "../book/build";
import { GrimoireError } from "../codes";
import type { BookAdapter } from "../contracts/adapter";
import type { GrimoireSnapshot, OpenGrimoireOptions } from "../contracts/snapshot";
import { derivedInputs, movedInputs, readDerived } from "./derived";

/** The error of a project whose book was never built, or was built by another version. */
function notBuilt(reason: string): GrimoireError {
  return new GrimoireError(
    "GR9007",
    `${reason} Run warlock grimoire build, then ask again (warlock scry only reads the book).`,
  );
}

/**
 * Open the stored book without building it. Throws `GR9007` when there is no
 * book, or its derived data is missing or from another version.
 *
 * @param root Absolute project root.
 */
export async function openStoredGrimoire(
  root: string,
  adapter: BookAdapter,
  options: OpenGrimoireOptions = {},
): Promise<GrimoireSnapshot> {
  const checked = await checkBook(root, adapter);

  if (checked === null) throw notBuilt("The book has not been built yet.");

  const derived = await readDerived(root, grimoireVersion());

  if (derived === null) {
    throw notBuilt("The book's derived data is missing or was written by another version.");
  }

  if (derived.builtAt !== checked.book.manifest.builtAt) {
    throw notBuilt("The book's derived data does not match its manifest (a build did not finish).");
  }

  const moved = movedInputs(derived.inputs, await derivedInputs(root, options.testResultsFile));
  const changed = checked.changed.length + moved;

  return {
    root: checked.book.root,
    book: checked.book,
    routes: checked.book.routes,
    ...derived.snapshot,
    ...(changed > 0 ? { behind: { changed } } : {}),
  };
}

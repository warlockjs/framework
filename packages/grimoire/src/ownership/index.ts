/**
 * Who owns each source file (owned by T-128). Rules in `FileOwnership`.
 *
 * - A `@feature <id>` header tag that names a feature wins. A tag that names
 *   no feature is left out here (the check reports it as `GR3004`), so the
 *   folder rule decides.
 * - Otherwise the feature whose `folders` entry is the deepest folder holding
 *   the file owns it.
 * - Two features claiming the file the same way (two different tags, or the
 *   same deepest folder listed by two features) is a conflict: the file gets
 *   no owner and `conflicts` lists the claims (`GR3003`).
 * - A feature borrows a file it does not own when one of its own files
 *   imports it directly. Spec files are never own or borrowed files and do
 *   not make a feature borrow anything.
 */
import type { BookFacts, BookFile } from "../contracts/adapter";
import type { FileOwnership, Ownership } from "../contracts/bookmap";
import type { WrittenGrimoire } from "../contracts/written";
import { isInsideFolder, toPosixPath } from "../paths";

type Claim = { feature: string; via: "tag" | "folder"; folder: string | null };

function normalizeFolder(folder: string): string {
  return toPosixPath(folder.trim()).replace(/^\.\//, "").replace(/\/+$/, "");
}

/** Feature ids named by a file's `@feature` tags, trimmed, unique, in tag order. */
function taggedFeatures(file: BookFile): string[] {
  const values = (file.tags.feature ?? [])
    .map((value) => value.trim().split(/\s+/)[0] ?? "")
    .filter((value) => value.length > 0);

  return [...new Set(values)];
}

/** Whether a file counts as an own, borrowed or unreached file of a feature. */
export function countsForFeature(file: Pick<BookFile, "type">): boolean {
  return file.type !== "spec";
}

function decide(
  file: BookFile,
  features: Set<string>,
  folders: Map<string, string[]>,
): FileOwnership {
  const result: FileOwnership = {
    file: file.file,
    owner: null,
    via: null,
    folder: null,
    conflicts: [],
    borrowedBy: [],
  };
  const tags = taggedFeatures(file).filter((feature) => features.has(feature));

  if (tags.length === 1) {
    result.owner = tags[0] ?? null;
    result.via = "tag";

    return result;
  }

  if (tags.length > 1) {
    result.conflicts = tags.sort().map((feature) => ({ feature, via: "tag" }));

    return result;
  }

  let deepest: Claim[] = [];
  let depth = -1;

  for (const [feature, list] of folders) {
    for (const folder of list) {
      if (!isInsideFolder(file.file, folder)) continue;

      const folderDepth = folder.split("/").length;

      if (folderDepth > depth) {
        depth = folderDepth;
        deepest = [{ feature, via: "folder", folder }];
      } else if (folderDepth === depth && !deepest.some((claim) => claim.feature === feature)) {
        deepest.push({ feature, via: "folder", folder });
      }
    }
  }

  if (deepest.length === 1) {
    const claim = deepest[0];

    if (claim) {
      result.owner = claim.feature;
      result.via = "folder";
      result.folder = claim.folder;
    }
  } else if (deepest.length > 1) {
    result.conflicts = deepest
      .map((claim) => ({ feature: claim.feature, via: claim.via }))
      .sort((left, right) => left.feature.localeCompare(right.feature));
  }

  return result;
}

/** Owner, conflicts and borrowers of every code file in `facts`. Pure. */
export function resolveOwnership(written: WrittenGrimoire, facts: BookFacts): Ownership {
  const featureIds = new Set(written.features.map((feature) => feature.id));
  const folders = new Map<string, string[]>();

  for (const feature of written.features) {
    const list = (feature.readme?.folders ?? [])
      .map((folder) => normalizeFolder(folder.value))
      .filter((folder) => folder.length > 0);

    folders.set(feature.id, [...new Set(list)]);
  }

  const files: Record<string, FileOwnership> = {};

  for (const file of facts.files) {
    files[file.file] = decide(file, featureIds, folders);
  }

  const features: Ownership["features"] = {};

  for (const id of [...featureIds].sort()) {
    features[id] = { own: [], borrowed: [] };
  }

  const byPath = new Map(facts.files.map((file) => [file.file, file]));
  const borrowers = new Map<string, Set<string>>();

  for (const file of facts.files) {
    const owner = files[file.file]?.owner ?? null;

    if (owner === null || !countsForFeature(file)) continue;

    features[owner]?.own.push(file.file);

    for (const entry of file.imports) {
      if (entry.file === null || entry.file === file.file) continue;

      const imported = files[entry.file];

      if (!imported || imported.owner === owner) continue;

      const importedFile = byPath.get(entry.file);

      if (importedFile && !countsForFeature(importedFile)) continue;

      const set = borrowers.get(entry.file) ?? new Set<string>();
      set.add(owner);
      borrowers.set(entry.file, set);
    }
  }

  for (const [file, set] of borrowers) {
    const ownership = files[file];
    const sorted = [...set].sort();

    if (ownership) ownership.borrowedBy = sorted;

    for (const feature of sorted) features[feature]?.borrowed.push(file);
  }

  for (const entry of Object.values(features)) {
    entry.own.sort();
    entry.borrowed.sort();
  }

  return { files, features };
}

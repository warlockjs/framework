/**
 * GR3001–GR3006: source files without a header or an owner, owners in
 * conflict, and own files that no flow reaches.
 */
import { createFinding } from "../../codes";
import type { BookFile } from "../../contracts/adapter";
import type { GrimoireFinding } from "../../contracts/findings";
import type { GrimoireSnapshot } from "../../contracts/snapshot";
import { isInsideFolder, toPosixPath } from "../../paths";

/** File types that need no header sentence (GR3001). */
const NO_HEADER_TYPES: ReadonlySet<string> = new Set(["spec", "type", "locale", "config"]);
/** File types that need no feature (GR3002). */
const NO_FEATURE_TYPES: ReadonlySet<string> = new Set(["spec", "type", "locale", "config", "main"]);

/** The top of a source file: where a header or a tag is written. */
function top(file: string): { file: string; line: number; column: null } {
  return { file, line: 1, column: null };
}

/** GR3001: a code file with no header sentence. Specs, types, locales, configs and `.d.ts` files are left out. */
export function checkHeaders(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  return snapshot.book.facts.files
    .filter(
      (file) =>
        file.about === null && !NO_HEADER_TYPES.has(file.type) && !/\.d\.[cm]?ts$/.test(file.file),
    )
    .map((file) =>
      createFinding({
        code: "GR3001",
        message: `${file.file} has no header sentence`,
        at: top(file.file),
        feature: snapshot.ownership.files[file.file]?.owner ?? null,
      }),
    );
}

/**
 * GR3002: a file under `src/app/` (not `src/app/shared/`) that no feature owns.
 * GR3003: a file two features claim. GR3004: a `@feature` tag naming no
 * feature. Only when the project has written files.
 */
export function checkOwners(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  if (!snapshot.written.exists) return [];

  const features = new Set(snapshot.written.features.map((feature) => feature.id));
  const findings: GrimoireFinding[] = [];

  for (const file of snapshot.book.facts.files) {
    const ownership = snapshot.ownership.files[file.file];

    if (ownership && ownership.conflicts.length > 0) {
      const claims = ownership.conflicts
        .map((claim) => `${claim.feature} (${claim.via})`)
        .join(", ");

      findings.push(
        createFinding({
          code: "GR3003",
          message: `${file.file} is claimed by ${claims}`,
          at: top(file.file),
        }),
      );
    } else if (needsFeature(file) && !ownership?.owner) {
      findings.push(
        createFinding({
          code: "GR3002",
          message: `${file.file} belongs to no feature`,
          at: top(file.file),
        }),
      );
    }

    for (const tag of file.tags["feature"] ?? []) {
      if (features.has(tag)) continue;

      findings.push(
        createFinding({
          code: "GR3004",
          message: `${file.file} is tagged @feature ${tag}, which is no feature`,
          at: top(file.file),
        }),
      );
    }
  }

  return findings;
}

function needsFeature(file: BookFile): boolean {
  const path = toPosixPath(file.file);

  return (
    isInsideFolder(path, "src/app") &&
    !isInsideFolder(path, "src/app/shared") &&
    !NO_FEATURE_TYPES.has(file.type)
  );
}

/**
 * GR3005: a feature `folders` entry that holds no file the book knows (every
 * file under the source roots, code or not).
 */
export function checkFolders(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  const known = [
    ...Object.keys(snapshot.book.manifest.files),
    ...snapshot.book.facts.files.map((file) => file.file),
  ].map(toPosixPath);
  const findings: GrimoireFinding[] = [];

  for (const feature of snapshot.written.features) {
    for (const folder of feature.readme?.folders ?? []) {
      if (known.some((file) => isInsideFolder(file, folder.value))) continue;

      findings.push(
        createFinding({
          code: "GR3005",
          message: `folders entry "${folder.value}" of ${feature.id} holds no source file`,
          at: folder.at,
          feature: feature.id,
        }),
      );
    }
  }

  return findings;
}

/** GR3006: a file a feature owns that no step of its flows reaches (`FeatureBookmap.unreached`). */
export function checkUnreached(snapshot: GrimoireSnapshot): GrimoireFinding[] {
  return Object.values(snapshot.collected.features).flatMap((bookmap) =>
    bookmap.unreached.map((file) =>
      createFinding({
        code: "GR3006",
        message: `${file} is owned by ${bookmap.feature}, but no flow of ${bookmap.feature} reaches it`,
        at: top(file),
        feature: bookmap.feature,
      }),
    ),
  );
}

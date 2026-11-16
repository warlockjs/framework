/**
 * Where everything lives under `grimoire/`, and how a source file maps to its
 * book entry. Every path here is project-relative and uses `/`.
 */
import path from "node:path";

/** The folder at the project root. */
export const GRIMOIRE_DIR = "grimoire";

/** Project-relative paths of the Grimoire layout. Agent-written unless marked Warlock. */
export const GRIMOIRE_PATHS = {
  /** Warlock. The generated book (ignored by git). */
  book: "grimoire/book",
  /** Warlock. The freshness fingerprint. */
  bookManifest: "grimoire/book/manifest.json",
  /** Warlock. The adapter's last facts (machine use). */
  bookFactsCache: "grimoire/book/.cache/facts.json",
  /** Warlock. Every route, by module. */
  bookRoutes: "grimoire/book/app/routes.json",
  /** Warlock (the Vitest reporter). Test results per proving test. */
  testResults: "grimoire/book/test-results.json",
  /** Warlock. Default folder of the static devtools export. */
  staticSite: "grimoire/book/site",
  features: "grimoire/features",
  /** Warlock. */
  featuresIndex: "grimoire/features/index.json",
  apps: "grimoire/apps",
  tasks: "grimoire/tasks",
  openTasks: "grimoire/tasks/open",
  doneTasks: "grimoire/tasks/done",
  /** Warlock. */
  tasksIndex: "grimoire/tasks/index.json",
  releases: "grimoire/releases",
} as const;

/** Lines a project's `.gitignore` needs so Warlock's files stay out of git. */
export const GRIMOIRE_IGNORE_RULES = [
  "/grimoire/book/",
  "/grimoire/features/index.json",
  "/grimoire/features/**/bookmap.json",
  "/grimoire/features/**/*.bookmap.json",
  "/grimoire/tasks/index.json",
] as const;

const CODE_EXTENSION = /\.(?:d\.ts|[cm]?[jt]s|[jt]sx)$/;

/** A path with `\` turned into `/`. */
export function toPosixPath(file: string): string {
  return file.split("\\").join("/");
}

/** A project-relative POSIX path for an absolute or relative path. */
export function projectPath(root: string, file: string): string {
  return toPosixPath(path.relative(root, path.resolve(root, file)));
}

/** Whether a project-relative file is inside a project-relative folder (or is it). */
export function isInsideFolder(file: string, folder: string): boolean {
  const normalizedFolder = toPosixPath(folder).replace(/\/+$/, "");
  const normalizedFile = toPosixPath(file);

  return normalizedFile === normalizedFolder || normalizedFile.startsWith(`${normalizedFolder}/`);
}

/** Whether a file name is a code file the book has an entry for. */
export function isCodeFile(file: string): boolean {
  return CODE_EXTENSION.test(file);
}

/** Book paths Warlock writes for lists; a mirrored entry never takes one of them. */
export function isReservedBookPath(bookPath: string): boolean {
  return (
    bookPath === GRIMOIRE_PATHS.bookManifest ||
    bookPath === GRIMOIRE_PATHS.bookRoutes ||
    bookPath === GRIMOIRE_PATHS.testResults ||
    bookPath.startsWith(`${GRIMOIRE_PATHS.book}/.cache/`) ||
    bookPath.startsWith(`${GRIMOIRE_PATHS.staticSite}/`) ||
    /^grimoire\/book\/web\/[^/]+\.pages\.json$/.test(bookPath) ||
    /^grimoire\/book\/mobile\/[^/]+\.screens\.json$/.test(bookPath)
  );
}

/** The mirror of a source file without the collision rules: `src/` dropped, extension → `.json`. */
function plainEntryPath(file: string, mobileApp: string | null, mobileRoot: string | null): string {
  const posix = toPosixPath(file);
  let relative: string;

  if (mobileApp !== null && mobileRoot !== null && isInsideFolder(posix, mobileRoot)) {
    relative = `mobile/${mobileApp}/${posix.slice(toPosixPath(mobileRoot).replace(/\/+$/, "").length + 1)}`;
  } else {
    relative = posix.startsWith("src/") ? posix.slice(4) : posix;
  }

  return `${GRIMOIRE_PATHS.book}/${relative.replace(CODE_EXTENSION, "")}.json`;
}

/** One file to place in the book. */
export type BookPathInput = {
  file: string;
  /** Mobile app id and root when the file belongs to a mobile app. */
  mobileApp?: { id: string; root: string } | null;
};

/**
 * The book entry path of every given code file.
 *
 * `src/app/auth/controllers/login.controller.ts` →
 * `grimoire/book/app/auth/controllers/login.controller.json`; a mobile app
 * file `mobile/app/index.tsx` of app `mobile` →
 * `grimoire/book/mobile/mobile/app/index.json`.
 *
 * When two files would share a path (`a.ts` and `a.tsx`), or a file would
 * take a reserved list path (`src/app/routes.ts` → `app/routes.json`), those
 * files keep their full name instead: `a.ts.json`, `routes.ts.json`.
 */
export function bookEntryPaths(files: readonly BookPathInput[]): Map<string, string> {
  const plain = new Map<string, string>();
  const counts = new Map<string, number>();

  for (const input of files) {
    const entry = plainEntryPath(
      input.file,
      input.mobileApp?.id ?? null,
      input.mobileApp?.root ?? null,
    );
    plain.set(input.file, entry);
    counts.set(entry, (counts.get(entry) ?? 0) + 1);
  }

  const result = new Map<string, string>();

  for (const input of files) {
    const entry = plain.get(input.file);

    if (entry === undefined) continue;

    if ((counts.get(entry) ?? 0) > 1 || isReservedBookPath(entry)) {
      const name = path.posix.basename(toPosixPath(input.file));
      result.set(input.file, `${path.posix.dirname(entry)}/${name}.json`);
    } else {
      result.set(input.file, entry);
    }
  }

  return result;
}

/** The book entry path of one file, when no other file can collide with it. */
export function bookEntryPath(input: BookPathInput): string {
  return bookEntryPaths([input]).get(input.file) ?? plainEntryPath(input.file, null, null);
}

/** `grimoire/book/web/<site>.pages.json`. */
export function sitePagesPath(site: string): string {
  return `${GRIMOIRE_PATHS.book}/web/${site}.pages.json`;
}

/** `grimoire/book/mobile/<app>.screens.json`. */
export function mobileScreensPath(app: string): string {
  return `${GRIMOIRE_PATHS.book}/mobile/${app}.screens.json`;
}

/** `grimoire/book/<module without src/>/index.md`. */
export function moduleSummaryPath(module: string): string {
  const posix = toPosixPath(module);

  return `${GRIMOIRE_PATHS.book}/${posix.startsWith("src/") ? posix.slice(4) : posix}/index.md`;
}

/** `grimoire/features/<feature>/bookmap.json`. */
export function featureBookmapPath(feature: string): string {
  return `${GRIMOIRE_PATHS.features}/${feature}/bookmap.json`;
}

/** `grimoire/features/<feature>/flows/<flow>.bookmap.json`. */
export function flowBookmapPath(feature: string, flow: string): string {
  return `${GRIMOIRE_PATHS.features}/${feature}/flows/${flow}.bookmap.json`;
}

/** `grimoire/releases/<release>.md`. */
export function releaseFilePath(release: string): string {
  return `${GRIMOIRE_PATHS.releases}/${release}.md`;
}

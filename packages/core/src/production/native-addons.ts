import { existsSync, readdirSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * A package in the bundle graph that ships a compiled `.node` binary (or whose
 * platform packages do). A bundler cannot inline one, so it stays a bare
 * `require` / `import` in the bundle and is copied next to it instead.
 */
export type NativePackage = {
  /** The package name, e.g. `@napi-rs/keyring` */
  name: string;
  /** Absolute directory of the package on disk */
  directory: string;
};

type Manifest = {
  name?: string;
  version?: string;
  gypfile?: boolean;
  os?: string[];
  cpu?: string[];
  libc?: string[];
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

/** Read a package manifest; `undefined` when absent or malformed. */
export function readManifest(directory: string): Manifest | undefined {
  try {
    return JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")) as Manifest;
  } catch {
    return undefined;
  }
}

/**
 * The directory of the package that owns `file`: the nearest ancestor whose
 * `package.json` carries a `name`. A manifest without one (the
 * `{"type":"commonjs"}` markers packages publish) is not a package.
 */
export function findPackageDirectory(file: string): string | undefined {
  let directory = path.dirname(file);

  for (;;) {
    const manifest = readManifest(directory);

    if (manifest && typeof manifest.name === "string" && manifest.name.length > 0) {
      return directory;
    }

    const parent = path.dirname(directory);

    if (parent === directory) return undefined;

    directory = parent;
  }
}

/** Folders never worth looking into for a binary, or worth copying. */
const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "test",
  "tests",
  "__tests__",
  "docs",
  "doc",
  "example",
  "examples",
  ".github",
]);

/** Whether a `.node` file exists in `directory`, at most `depth` levels down. */
function containsNodeBinary(directory: string, depth: number): boolean {
  let entries: import("node:fs").Dirent[];

  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".node")) return true;
  }

  if (depth <= 0) return false;

  return entries.some(
    (entry) =>
      entry.isDirectory() &&
      !IGNORED_DIRECTORIES.has(entry.name) &&
      containsNodeBinary(path.join(directory, entry.name), depth - 1),
  );
}

/**
 * Find the directory of package `name` as Node would see it from `from`:
 * `<ancestor>/node_modules/<name>`, plus the sibling slot of a pnpm virtual
 * store (`…/.pnpm/<id>/node_modules/<name>`) when `from` is itself inside one.
 */
export function locatePackage(name: string, from: string): string | undefined {
  let directory = from;

  for (;;) {
    const nested = path.join(directory, "node_modules", name);

    if (existsSync(path.join(nested, "package.json"))) return nested;

    if (path.basename(directory) === "node_modules") {
      const sibling = path.join(directory, name);

      if (existsSync(path.join(sibling, "package.json"))) return sibling;
    }

    const parent = path.dirname(directory);

    if (parent === directory) return undefined;

    directory = parent;
  }
}

const nativeCache = new Map<string, boolean>();

/**
 * Whether the package at `directory` needs a compiled binary to load: it holds
 * a `.node` file within three levels, declares `gypfile`, or is a napi-style
 * loader whose platform packages (`optionalDependencies` carrying `os` / `cpu`)
 * hold one.
 */
export function isNativePackage(directory: string): boolean {
  const cached = nativeCache.get(directory);

  if (cached !== undefined) return cached;

  const manifest = readManifest(directory);
  let native = manifest?.gypfile === true || containsNodeBinary(directory, 3);

  if (!native && manifest?.optionalDependencies) {
    for (const optional of Object.keys(manifest.optionalDependencies)) {
      const located = locatePackage(optional, directory);
      const optionalManifest = located ? readManifest(located) : undefined;

      if (
        located &&
        (optionalManifest?.os || optionalManifest?.cpu) &&
        containsNodeBinary(located, 3)
      ) {
        native = true;
        break;
      }
    }
  }

  nativeCache.set(directory, native);

  return native;
}

/** Forget cached answers. Tests rewrite fixture folders between runs. */
export function clearNativePackageCache(): void {
  nativeCache.clear();
}

function isMusl(): boolean {
  if (process.platform !== "linux") return false;

  const report = process.report?.getReport?.() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;

  return !report?.header?.glibcVersionRuntime;
}

/**
 * Whether a package's `os` / `cpu` / `libc` fields allow it on this machine. A
 * field that is absent allows everything; a `!`-prefixed entry blocks.
 */
export function matchesPlatform(
  manifest: Pick<Manifest, "os" | "cpu" | "libc">,
  platform: { os: string; cpu: string; libc?: "glibc" | "musl" } = {
    os: process.platform,
    cpu: process.arch,
    libc: process.platform === "linux" ? (isMusl() ? "musl" : "glibc") : undefined,
  },
): boolean {
  const allows = (list: string[] | undefined, value: string | undefined): boolean => {
    if (!list || list.length === 0 || value === undefined) return true;

    const blocked = list.filter((entry) => entry.startsWith("!")).map((entry) => entry.slice(1));

    if (blocked.includes(value)) return false;

    const allowed = list.filter((entry) => !entry.startsWith("!"));

    return allowed.length === 0 || allowed.includes(value);
  };

  return (
    allows(manifest.os, platform.os) &&
    allows(manifest.cpu, platform.cpu) &&
    allows(manifest.libc, platform.libc)
  );
}

/** Files a native package never needs at load time. */
const SKIPPED_FILE =
  /(\.(md|markdown|map|tsbuildinfo|cc|cpp|cxx|c|h|hpp|gyp|gypi|cmake|pdb|lib|obj|o)$|\.d\.[cm]?ts$|^(license|licence|changelog|readme|history|authors|notice)(\..*)?$)/i;

async function copyPackageFiles(source: string, target: string): Promise<number> {
  let copied = 0;

  await mkdir(target, { recursive: true });

  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;

      copied += await copyPackageFiles(from, to);
    } else if (entry.isFile() || (await stat(from)).isFile()) {
      if (entry.name !== "package.json" && SKIPPED_FILE.test(entry.name)) continue;

      await copyFile(from, to);
      copied++;
    }
  }

  return copied;
}

/** What {@link stageNativePackages} copied. */
export type StagedNativePackages = {
  /** Every package copied, native ones and the dependencies they load */
  staged: string[];
  /** Dependencies that could not be located on disk */
  missing: string[];
};

/**
 * Copy each native package, plus the dependencies it loads at runtime, into
 * `<distDirectory>/node_modules/<name>` so `node dist/app.js` finds them with
 * no `node_modules` above `dist/`.
 *
 * Only what is needed to load is copied: the manifest, JavaScript, the
 * binaries and data files — not docs, tests, type declarations or native
 * sources. Dependencies follow `dependencies` and `optionalDependencies`
 * (platform packages), skipping any whose `os` / `cpu` / `libc` do not match
 * this machine.
 */
export async function stageNativePackages(
  distDirectory: string,
  packages: readonly NativePackage[],
  platform?: Parameters<typeof matchesPlatform>[1],
): Promise<StagedNativePackages> {
  const staged = new Map<string, string>();
  const missing: string[] = [];
  const queue: NativePackage[] = [...packages];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (staged.has(current.name)) continue;

    const manifest = readManifest(current.directory) ?? {};

    if (!matchesPlatform(manifest, platform)) continue;

    staged.set(current.name, current.directory);
    await copyPackageFiles(
      current.directory,
      path.join(distDirectory, "node_modules", current.name),
    );

    const required = Object.keys(manifest.dependencies ?? {});
    const optional = Object.keys(manifest.optionalDependencies ?? {});

    for (const name of [...required, ...optional]) {
      if (staged.has(name)) continue;

      const directory = locatePackage(name, current.directory);

      if (!directory) {
        if (required.includes(name) && !optional.includes(name)) missing.push(name);

        continue;
      }

      queue.push({ name, directory });
    }
  }

  return { staged: [...staged.keys()], missing };
}

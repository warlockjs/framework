/**
 * The client build's Vite manifest (`<clientDir>/.vite/manifest.json`), parsed
 * once per file version.
 *
 * A production install asks it for every page route (its stylesheet chain, its
 * module preloads), and a request asks it for each new set of stylesheets
 * declared through `linkStylesheetsFor()`. The file does not change under a
 * running process, so it is read and parsed once; a cheap `stat` per lookup
 * still notices a file that was rewritten, which then reads again.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** One manifest record, as far as the server reads it. */
export type ClientManifestEntry = {
  file?: unknown;
  css?: unknown;
  imports?: unknown;
  name?: unknown;
  isEntry?: unknown;
};

export type ClientManifest = Record<string, ClientManifestEntry | undefined>;

type CachedManifest = {
  readonly version: string;
  readonly manifest: ClientManifest | undefined;
};

const manifests = new Map<string, CachedManifest>();

/** The parsed manifest of `clientDir`; `undefined` when it is missing or malformed. */
export function readClientManifest(clientDir: string): ClientManifest | undefined {
  const manifestPath = path.join(clientDir, ".vite", "manifest.json");
  let version: string;

  try {
    const stats = statSync(manifestPath, { bigint: true });
    version = `${stats.ino}:${stats.size}:${stats.mtimeNs}`;
  } catch {
    manifests.delete(manifestPath);
    return undefined;
  }

  const known = manifests.get(manifestPath);
  if (known !== undefined && known.version === version) return known.manifest;

  const manifest = parseManifest(manifestPath);
  manifests.set(manifestPath, { version, manifest });

  return manifest;
}

function parseManifest(manifestPath: string): ClientManifest | undefined {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as unknown;

    return typeof manifest === "object" && manifest !== null
      ? (manifest as ClientManifest)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Each manifest's keys by every `/`-boundary suffix, first key first. */
const suffixIndexes = new WeakMap<ClientManifest, Map<string, string>>();

function suffixIndexOf(manifest: ClientManifest): Map<string, string> {
  const known = suffixIndexes.get(manifest);
  if (known !== undefined) return known;

  const index = new Map<string, string>();

  for (const key of Object.keys(manifest)) {
    for (let slash = key.indexOf("/"); slash !== -1; slash = key.indexOf("/", slash + 1)) {
      const suffix = key.slice(slash + 1);
      if (!index.has(suffix)) index.set(suffix, key);
    }
  }

  suffixIndexes.set(manifest, index);

  return index;
}

/**
 * Find the manifest key for an app-root-relative POSIX source id.
 *
 * VITE KEYS BY SOURCE PATH RELATIVE TO ITS OWN `root`, not to the app's
 * `appRoot` — the client build's `root` is the framework's own package
 * (`build-client.ts`), so a key for an app source file carries a `../`-laden
 * prefix (`"../my-app/src/web/root.tsx"`) rather than matching `sourceFile`
 * (`"src/web/root.tsx"`) byte for byte. The two forms always share the same
 * TAIL, though — both are anchored at the same file — so an exact match is
 * tried first (the case where the client build's root IS the app root, which
 * every fixture and every test uses) and a `/`-boundary suffix match second
 * (the first key, in manifest order, that ends with `/<sourceFile>`), rather
 * than trying to reconstruct the build's own root here, which this runtime
 * read has no way to independently confirm.
 */
export function findManifestKey(manifest: ClientManifest, sourceFile: string): string | undefined {
  if (manifest[sourceFile] !== undefined) return sourceFile;

  return suffixIndexOf(manifest).get(sourceFile);
}

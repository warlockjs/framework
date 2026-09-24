/** Storage-independent schema and key helpers for immutable sitemap generations. */
export const GENERATION_MANIFEST_VERSION = 1 as const;
export const MANIFEST_FENCE_WIDTH = 16;

export type SitemapGenerationKind = "single" | "index";

export type SitemapGenerationFile = {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
};

export type SitemapGenerationManifest = {
  readonly version: typeof GENERATION_MANIFEST_VERSION;
  readonly fence: number;
  readonly generationId: string;
  readonly coversRev: number;
  readonly kind: SitemapGenerationKind;
  readonly mainFile: string;
  readonly files: readonly SitemapGenerationFile[];
  readonly entries: number;
  readonly generatedAt: string;
};

export type SitemapManifestKey = {
  readonly key: string;
  readonly fence: number;
  readonly generationId: string;
};

export class InvalidSitemapGenerationManifestError extends Error {
  public constructor(message: string) {
    super(`Invalid sitemap generation manifest: ${message}`);
    this.name = "InvalidSitemapGenerationManifestError";
  }
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MANIFEST_KEY = /^manifests\/(\d{16})-([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.json$/;

function fail(message: string): never {
  throw new InvalidSitemapGenerationManifestError(message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    return fail(`${label} must be a safe non-negative integer.`);
  return value as number;
}

function generationIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value))
    return fail(`${label} must be a safe generation identifier.`);
  return value;
}

function generatedAt(value: unknown): string {
  if (typeof value !== "string" || !ISO_DATE_TIME.test(value) || Number.isNaN(Date.parse(value))) {
    return fail("generatedAt must be a valid ISO-8601 date-time.");
  }
  return value;
}

function artifactPath(value: unknown, generationId: string, label: string): string {
  if (typeof value !== "string") return fail(`${label} must be a string.`);
  const prefix = `generations/${generationId}/`;
  if (!value.startsWith(prefix)) return fail(`${label} must be contained in ${prefix}.`);
  const fileName = value.slice(prefix.length);
  if (
    !SAFE_FILE_NAME.test(fileName) ||
    fileName.includes("/") ||
    fileName === "." ||
    fileName === ".."
  ) {
    return fail(`${label} must name one safe, flat artifact file.`);
  }
  return value;
}

function manifestFile(value: unknown, generationId: string, index: number): SitemapGenerationFile {
  const record = object(value, `files[${index}]`);
  const path = artifactPath(record.path, generationId, `files[${index}].path`);
  const bytes = nonNegativeInteger(record.bytes, `files[${index}].bytes`);
  if (typeof record.sha256 !== "string" || !SHA256.test(record.sha256)) {
    return fail(`files[${index}].sha256 must be a lowercase SHA-256 hex digest.`);
  }
  return { path, bytes, sha256: record.sha256 };
}

/** Parse untrusted JSON into the v1 manifest contract. It does not touch storage. */
export function parseSitemapGenerationManifest(value: unknown): SitemapGenerationManifest {
  const record = object(value, "manifest");
  if (record.version !== GENERATION_MANIFEST_VERSION)
    return fail(`version must be ${GENERATION_MANIFEST_VERSION}.`);

  const fence = nonNegativeInteger(record.fence, "fence");
  const generationId = generationIdentifier(record.generationId, "generationId");
  const coversRev = nonNegativeInteger(record.coversRev, "coversRev");
  if (record.kind !== "single" && record.kind !== "index")
    return fail('kind must be "single" or "index".');
  if (!Array.isArray(record.files) || record.files.length === 0)
    return fail("files must be a non-empty array.");

  const files = record.files.map((file, index) => manifestFile(file, generationId, index));
  const paths = new Set<string>();
  const fileNames = new Set<string>();
  for (const file of files) {
    const fileName = file.path.slice(`generations/${generationId}/`.length);
    if (paths.has(file.path))
      return fail(`files contains duplicate path ${JSON.stringify(file.path)}.`);
    if (fileNames.has(fileName))
      return fail(`files contains duplicate public file name ${JSON.stringify(fileName)}.`);
    paths.add(file.path);
    fileNames.add(fileName);
  }

  const mainFile = artifactPath(record.mainFile, generationId, "mainFile");
  if (!paths.has(mainFile)) return fail("mainFile must match one files[].path.");

  return {
    version: GENERATION_MANIFEST_VERSION,
    fence,
    generationId,
    coversRev,
    kind: record.kind,
    mainFile,
    files,
    entries: nonNegativeInteger(record.entries, "entries"),
    generatedAt: generatedAt(record.generatedAt),
  };
}

/** Build the immutable v1 manifest object key for a generation fence. */
export function sitemapManifestKey(fence: number, generationId: string): string {
  const safeFence = nonNegativeInteger(fence, "fence");
  if (safeFence >= 10 ** MANIFEST_FENCE_WIDTH)
    return fail(`fence must fit within ${MANIFEST_FENCE_WIDTH} decimal digits.`);
  return `manifests/${String(safeFence).padStart(MANIFEST_FENCE_WIDTH, "0")}-${generationIdentifier(generationId, "generationId")}.json`;
}
/** Parse only the shape of a manifest object key; artifact validation belongs to the storage adapter. */
export function parseSitemapManifestKey(key: unknown): SitemapManifestKey | undefined {
  if (typeof key !== "string") return undefined;
  const match = MANIFEST_KEY.exec(key);
  if (!match) return undefined;
  const fence = Number(match[1]);
  const generationId = match[2];
  if (!Number.isSafeInteger(fence) || generationId === undefined) return undefined;
  return { key, fence, generationId };
}

/** Numeric-fence-descending candidates; callers validate storage contents before adoption. */
export function sortSitemapManifestCandidates(keys: readonly string[]): SitemapManifestKey[] {
  return keys
    .map(parseSitemapManifestKey)
    .filter((candidate): candidate is SitemapManifestKey => candidate !== undefined)
    .sort(
      (left, right) =>
        right.fence - left.fence || right.generationId.localeCompare(left.generationId),
    );
}

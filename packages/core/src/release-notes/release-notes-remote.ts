import { compareVersions, parseVersion } from "../upgrade/version";
import { parseReleaseNote, type ReleaseNote } from "./release-notes";

/** Where the documentation site publishes the release summaries. The only host the command contacts. */
export const RELEASE_NOTES_URL = "https://warlock.js.org/release-notes.json";

/** Longest response body accepted, in bytes. */
export const RELEASE_NOTES_MAX_BYTES = 2 * 1024 * 1024;

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RELEASES = 1_000;

/** The releases the site publishes: every one is parsed like a bundled summary. */
export type RemoteReleaseNotes = {
  /** The newest published version. */
  latest: string;
  /** Oldest first. */
  releases: ReleaseNote[];
};

export type RemoteReleaseNotesResult =
  | { ok: true; data: RemoteReleaseNotes }
  | { ok: false; reason: string };

type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string>; redirect?: "error" },
) => Promise<Response>;

export type FetchRemoteReleaseNotesOptions = {
  /** Abort budget in milliseconds (default 5000). */
  timeoutMs?: number;
  /** Longest accepted body in bytes (default 2 MB). */
  maxBytes?: number;
  /** The fetch implementation (default: the global `fetch`). */
  fetch?: FetchLike;
  /** The address to read (default: the documentation site's). Must be an HTTPS warlock.js.org address. */
  url?: string;
};

/** Whether an address is HTTPS on warlock.js.org. */
function isTrustedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    return parsed.protocol === "https:" && parsed.hostname === "warlock.js.org";
  } catch {
    return false;
  }
}

/** Read a response body as text, stopping as soon as it passes `maxBytes`. */
async function readCapped(response: Response, maxBytes: number): Promise<string | undefined> {
  const declared = Number(response.headers.get("content-length"));

  if (Number.isFinite(declared) && declared > maxBytes) return undefined;

  if (!response.body) {
    const text = await response.text();

    return Buffer.byteLength(text) > maxBytes ? undefined : text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;

    size += value.byteLength;

    if (size > maxBytes) {
      await reader.cancel();
      return undefined;
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the published JSON and turn it into release notes. Returns the
 * reason when the shape is wrong. The summaries are kept as text and only ever
 * printed: nothing in the payload is executed or followed.
 */
export function parseRemoteReleaseNotes(json: unknown): RemoteReleaseNotesResult {
  if (!isPlainObject(json) || !Array.isArray(json.releases)) {
    return { ok: false, reason: "unexpected response shape" };
  }

  if (json.releases.length > MAX_RELEASES) return { ok: false, reason: "too many releases" };

  const releases: ReleaseNote[] = [];

  for (const entry of json.releases) {
    if (!isPlainObject(entry)) return { ok: false, reason: "unexpected response shape" };

    const { version, summary } = entry;

    if (
      typeof version !== "string" ||
      typeof summary !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(version) ||
      !parseVersion(version)
    ) {
      return { ok: false, reason: "unexpected response shape" };
    }

    releases.push(parseReleaseNote(version, summary));
  }

  releases.sort((a, b) => compareVersions(a.version, b.version));

  const newest = releases.at(-1)?.version;
  const latest =
    typeof json.latest === "string" && parseVersion(json.latest) ? json.latest : newest;

  if (!latest) return { ok: false, reason: "no releases listed" };

  return { ok: true, data: { latest, releases } };
}

/**
 * Fetch the release notes the documentation site publishes. Never throws:
 * a network error, timeout, non-200 status, oversized body, non-JSON body or
 * wrong shape all resolve to `{ ok: false, reason }`.
 */
export async function fetchRemoteReleaseNotes(
  options: FetchRemoteReleaseNotesOptions = {},
): Promise<RemoteReleaseNotesResult> {
  const url = options.url ?? RELEASE_NOTES_URL;

  if (!isTrustedUrl(url)) return { ok: false, reason: "address is not https://warlock.js.org" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await (options.fetch ?? fetch)(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      // A redirect could leave warlock.js.org, so it counts as a failed check.
      redirect: "error",
    });

    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };

    const body = await readCapped(response, options.maxBytes ?? RELEASE_NOTES_MAX_BYTES);

    if (body === undefined) return { ok: false, reason: "response too large" };

    let json: unknown;

    try {
      json = JSON.parse(body);
    } catch {
      return { ok: false, reason: "response is not valid JSON" };
    }

    return parseRemoteReleaseNotes(json);
  } catch (error) {
    return {
      ok: false,
      reason: controller.signal.aborted
        ? "timed out"
        : error instanceof Error
          ? error.message
          : "network error",
    };
  } finally {
    clearTimeout(timer);
  }
}

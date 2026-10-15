/**
 * Minimal npm-registry access for the framework's self-update tooling
 * (the dev-server update notice + the `warlock update` command).
 *
 * No SDK and no caching layer — just the public registry over `fetch`.
 * Every lookup is best-effort: any failure resolves to `undefined` so a
 * registry hiccup can never break the dev server or the CLI.
 */

const REGISTRY_BASE_URL = "https://registry.npmjs.org";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Fetch the latest published version of a package from the npm registry.
 *
 * Hits the abbreviated `/<package>/latest` endpoint, which returns only the
 * latest dist-tag manifest (not the full packument). Resolves to `undefined`
 * on any failure — offline, timeout, non-200 response, or malformed payload —
 * and never throws, so callers can stay fail-silent.
 *
 * @param packageName Fully-qualified npm name, e.g. `@warlock.js/core`.
 * @param timeoutMs   Abort budget in milliseconds (defaults to 30_000 -> 30 seconds).
 */
export async function fetchLatestVersion(
  packageName: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${REGISTRY_BASE_URL}/${packageName}/latest`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as { version?: unknown };

    return typeof data.version === "string" ? data.version : undefined;
  } catch {
    // Best-effort: offline, DNS failure, abort/timeout, or bad JSON — all "unknown".
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

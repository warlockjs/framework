import { appendLog, readManifest, readPointer, writeManifest, type ReleaseContext } from "./store";

export type VerifyResult = {
  id: string;
  ok: boolean;
  attempts: number;
  reason?: string;
};

function readPath(value: unknown, dotted: string): unknown {
  let current: unknown = value;

  for (const key of dotted.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Why one attempt failed, or `null` when it matched the release. */
async function attempt(
  context: ReleaseContext,
  url: string,
  expected: { version: string; commit: string },
): Promise<string | null> {
  const { verify } = context.config;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), verify.timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (response.status !== verify.expectedStatus) {
      return `status ${response.status}, expected ${verify.expectedStatus}`;
    }

    if (verify.match.length === 0) return null;

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      return "the response is not JSON, so the version cannot be compared";
    }

    for (const field of verify.match) {
      const reported = readPath(body, field === "version" ? verify.versionPath : verify.commitPath);
      const wanted = expected[field];

      if (reported === undefined) {
        return `the response reports no ${field} (looked at "${
          field === "version" ? verify.versionPath : verify.commitPath
        }")`;
      }

      // A reported short commit counts when it is a prefix of the full one.
      const matches =
        field === "commit" && typeof reported === "string"
          ? reported.length >= 7 && wanted.startsWith(reported)
          : reported === wanted;

      if (!matches) return `reported ${field} ${String(reported)}, expected ${wanted}`;
    }

    return null;
  } catch (error) {
    return (error as Error).name === "AbortError"
      ? `no response within ${verify.timeoutMs}ms`
      : (error as Error).message;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET the health URL until it answers with the expected status and reports
 * the active release's version and commit, retrying with a pause between
 * attempts. The outcome is recorded in the active release's manifest.
 *
 * @example
 * const result = await verifyRelease(context);
 */
export async function verifyRelease(context: ReleaseContext): Promise<VerifyResult> {
  const { verify } = context.config;
  const id = await readPointer(context, "current");

  if (!id) throw new Error("No active release to verify.");
  if (!verify.url) throw new Error("Set release.verify.url to the health URL first.");

  const manifest = await readManifest(context, id);
  let reason: string | null = "not attempted";
  let attempts = 0;

  for (let index = 0; index <= verify.retries; index++) {
    if (index > 0) await sleep(verify.intervalMs);

    attempts += 1;
    reason = await attempt(context, verify.url, {
      version: manifest.version,
      commit: manifest.commit,
    });

    if (reason === null) break;
  }

  const ok = reason === null;

  await writeManifest(context, {
    ...manifest,
    verification: {
      at: context.now().toISOString(),
      ok,
      attempts,
      ...(ok ? {} : { reason: reason ?? undefined }),
    },
  });
  await appendLog(context, {
    event: "verify",
    release: id,
    ok,
    detail: ok ? `${attempts} attempt(s)` : (reason ?? undefined),
  });

  return { id, ok, attempts, ...(ok ? {} : { reason: reason ?? undefined }) };
}

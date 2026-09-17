/**
 * Joins a configured origin and an app-relative route path into one absolute
 * URL, with exactly one slash at the seam regardless of whether either side
 * already carries one.
 */
export function joinOrigin(origin: string, routePath: string): string {
  const trimmedOrigin = origin.endsWith("/") ? origin.slice(0, -1) : origin;
  const normalizedPath = routePath.startsWith("/") ? routePath : `/${routePath}`;

  return `${trimmedOrigin}${normalizedPath}`;
}

/**
 * Raised when the sitemap is enabled but no public origin is configured.
 * Refuses to boot rather than falling back to a request-derived origin: a
 * sitemap served with the wrong host is worse than one that refuses to
 * start, because nothing downstream ever tells you it was wrong.
 */
export class MissingPublicUrlError extends Error {
  public constructor() {
    super(
      "Sitemap is enabled but no public origin is configured. Set `app.publicUrl` " +
        "in warlock.config.ts, or the PUBLIC_APP_URL environment variable.",
    );
    this.name = "MissingPublicUrlError";
  }
}

export type ResolveOriginOptions = {
  /** `app.publicUrl` from the app's config, when set. */
  publicUrl?: string;
  /** Defaults to `process.env`; overridable for tests. */
  env?: Record<string, string | undefined>;
};

/**
 * The origin the sitemap is served from: `app.publicUrl` first, then the
 * `PUBLIC_APP_URL` env fallback. Throws {@link MissingPublicUrlError} when
 * neither is set — this is the boot-time check, called once, not per-request.
 */
export function resolveOrigin(options: ResolveOriginOptions = {}): string {
  const origin = options.publicUrl ?? options.env?.PUBLIC_APP_URL;

  if (!origin) throw new MissingPublicUrlError();

  return origin;
}

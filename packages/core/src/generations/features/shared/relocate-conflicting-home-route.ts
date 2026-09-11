import { getFileAsync, putFileAsync } from "@warlock.js/fs";
import glob from "fast-glob";
import { srcPath } from "../../../utils";

/**
 * A TOP-LEVEL `router.get("/", ...)` — anchored at column 0 on purpose.
 *
 * Routes nested in a `router.group({ prefix: "/x" }, ...)` are indented by every
 * formatter this codebase runs, and their real path is `/x`, not `/`. Anchoring
 * is what keeps the notifications feature's own `router.get("/", ...)` (inside
 * the `/notifications` group) from reading as a homepage collision.
 *
 * Only the path literal is captured. The handler — a bare identifier in the
 * template, but possibly an inline arrow spanning lines — is never matched, so
 * the rewrite below cannot damage it.
 */
const TOP_LEVEL_ROOT_GET = /^router\s*\.\s*get\(\s*(["'`])\/\1/gm;

/**
 * Whether `/welcome` is already spoken for, so relocating onto it would trade
 * one duplicate-route 500 for another.
 */
const TOP_LEVEL_WELCOME_GET = /^router\s*\.\s*get\(\s*(["'`])\/welcome\1/m;

export type HomeRouteCollision =
  /** Nothing under `src/app` claims a top-level `/` — write the page as normal. */
  | { outcome: "absent" }
  /** The one file that claimed `/` was moved to `/welcome`; the page is safe to write. */
  | { outcome: "relocated"; relativePath: string }
  /** Something claims `/` that we will not rewrite. The page is NOT written. */
  | { outcome: "conflict"; reason: string }
  /** We tried to relocate and could not. The page is NOT written. */
  | { outcome: "failed"; reason: string };

/** One routes source file, as read from disk (or handed to the pure resolver in a test). */
export type RoutesFileSource = {
  relativePath: string;
  source: string;
};

/** What {@link resolveHomeRouteCollision} decided, plus the sources it rewrote. */
export type HomeRouteResolution = {
  collision: HomeRouteCollision;
  rewrites: RoutesFileSource[];
};

/**
 * Decide what to do about `src/app/**\/routes.{ts,tsx}` claiming `/`, and
 * produce the rewritten source when exactly one file does.
 *
 * Pure by design: no filesystem access here, so this is the part a test can
 * exercise directly without touching disk. {@link relocateConflictingHomeRoute}
 * is the thin I/O wrapper — it reads the files, calls this, and writes back
 * whatever this returns in `rewrites`.
 *
 * @param files Every `routes.{ts,tsx}` file under `src/app`, with its current text.
 * @returns The collision outcome, and the (possibly empty) list of files to write back.
 */
export function resolveHomeRouteCollision(files: RoutesFileSource[]): HomeRouteResolution {
  const claimants = files
    .map((file) => ({ file, matches: file.source.match(TOP_LEVEL_ROOT_GET) ?? [] }))
    .filter(({ matches }) => matches.length > 0);

  if (claimants.length === 0) {
    return { collision: { outcome: "absent" }, rewrites: [] };
  }

  if (claimants.length > 1) {
    const names = claimants.map(({ file }) => file.relativePath).join(", ");

    return {
      collision: {
        outcome: "conflict",
        reason: `multiple files declare a top-level GET "/" (${names})`,
      },
      rewrites: [],
    };
  }

  const claimant = claimants[0];

  // The two guards above establish exactly one claimant, but the compiler does
  // not narrow a destructured element from a length check. Reporting "absent"
  // is the same answer the empty case gives, and the honest one: with no
  // claimant there is no conflicting home route to relocate.
  if (claimant === undefined) {
    return { collision: { outcome: "absent" }, rewrites: [] };
  }

  const { file, matches } = claimant;

  if (matches.length > 1) {
    return {
      collision: {
        outcome: "conflict",
        reason: `${file.relativePath} declares ${matches.length} top-level GET "/" routes`,
      },
      rewrites: [],
    };
  }

  if (TOP_LEVEL_WELCOME_GET.test(file.source)) {
    return {
      collision: {
        outcome: "conflict",
        reason: `${file.relativePath} already declares GET "/welcome", so the usual relocation target is taken`,
      },
      rewrites: [],
    };
  }

  const next = file.source.replace(TOP_LEVEL_ROOT_GET, (match: string, quote: string) =>
    match.replace(`${quote}/${quote}`, `${quote}/welcome${quote}`),
  );

  if (next === file.source) {
    return {
      collision: {
        outcome: "conflict",
        reason: `${file.relativePath}'s GET "/" route could not be rewritten`,
      },
      rewrites: [],
    };
  }

  return {
    collision: { outcome: "relocated", relativePath: file.relativePath },
    rewrites: [{ relativePath: file.relativePath, source: next }],
  };
}

/**
 * Make room for a page that declares `route.path = "/"`.
 *
 * The project template registers `router.get("/", homePageController)` and the
 * page stub declares `route.path = "/"`. Fastify rejects the second registration
 * (`Method 'GET' already declared for route '/'`) and the homepage 500s at
 * request time — so `warlock add web` cannot just write the page and hope.
 *
 * This used to check exactly one hardcoded path, `src/app/shared/routes.ts`.
 * That guard never fired on a real scaffold: the template registers the home
 * route at `src/app/home/routes.ts`, `fileExistsAsync` on the wrong path always
 * failed, and every call silently returned `absent` — the collision-avoidance
 * logic below existed and was correct, but was pointed at a file that does not
 * exist, so it never ran. It now scans every `src/app/**\/routes.{ts,tsx}`
 * instead of trusting one filename, so renaming the template's routes file
 * again cannot reintroduce the same silent no-op.
 *
 * Of the three ways out, this RELOCATES the JSON route to `/welcome` rather than
 * deleting it or refusing to scaffold:
 *
 * - Deleting the controller is what the scaffolder's own `react` feature does,
 *   but it may do that: it owns the file it is deleting, seconds after writing
 *   it. `warlock add web` runs against a project a human has been living in, and
 *   silently unlinking their code is not a thing an `add` command gets to do.
 * - Writing the page anyway and printing a warning ships a project whose
 *   homepage 500s. A warning above a broken app is still a broken app.
 * - Relocating keeps BOTH surfaces working: the React homepage takes `/`, the
 *   JSON welcome answers at `/welcome`, and no line of user code disappears.
 *
 * Only the exact top-level shape is rewritten, and only the path literal inside
 * it. Anything else that claims `/` is reported and left completely alone — we
 * do not guess at code we cannot recognise.
 */
export async function relocateConflictingHomeRoute(): Promise<HomeRouteCollision> {
  const relativePaths = await glob("**/routes.{ts,tsx}", {
    cwd: srcPath("app"),
    absolute: false,
  });

  if (relativePaths.length === 0) {
    return { outcome: "absent" };
  }

  let files: RoutesFileSource[];

  try {
    files = await Promise.all(
      relativePaths.map(async (relativePath) => ({
        relativePath: `app/${relativePath}`,
        source: await getFileAsync(srcPath("app", relativePath)),
      })),
    );
  } catch (error) {
    return {
      outcome: "failed",
      reason: `could not be read (${(error as Error).message})`,
    };
  }

  const { collision, rewrites } = resolveHomeRouteCollision(files);

  if (rewrites.length === 0) {
    return collision;
  }

  try {
    await Promise.all(
      rewrites.map((file) => putFileAsync(srcPath(file.relativePath), file.source)),
    );
  } catch (error) {
    return {
      outcome: "failed",
      reason: `could not be written (${(error as Error).message})`,
    };
  }

  return collision;
}

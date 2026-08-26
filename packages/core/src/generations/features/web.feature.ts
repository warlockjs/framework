import { colors } from "@mongez/copper";
import {
  ensureDirectoryAsync,
  fileExistsAsync,
  getFileAsync,
  putFileAsync,
} from "@warlock.js/fs";
import { CommandActionData } from "../../commands/types";
import { rootPath, srcPath } from "../../utils";
import { webHomePageStub, webRootStub } from "../stubs";
import { FeatureDefinition } from "./types";

/**
 * Register the WebConnector in `warlock.config.ts`, and ONLY there.
 *
 * It belongs to the config array or to app code, never both. Both halves are
 * registered before app code loads — the CLI preloader in dev, the generated
 * entry in production — so also calling `connectorsManager.register(...)` in
 * `src/app/main.ts` boots the connector twice and installs every page route
 * twice. That surfaces at PRODUCTION boot as `Route name "..." is already
 * taken`, because pages and API routes share one route-name namespace.
 *
 * The config array is the half to prefer: `warlock build` reads the same array
 * to drain each connector's build contribution, so "built for" and "boots with"
 * cannot drift.
 *
 * String surgery rather than a TypeScript parse: `warlock.config.ts` is an
 * app-owned file that may carry any formatting, and a parse-and-print would
 * reformat the parts we did not come to change.
 */
async function registerWebConnector(): Promise<void> {
  const configPath = rootPath("warlock.config.ts");

  if (!(await fileExistsAsync(configPath))) {
    console.log(
      `${colors.yellowBright("warlock.config.ts")} not found — add this yourself:\n` +
        `  import { webConnector } from "@warlock.js/web/connector";\n` +
        `  export default defineConfig({ connectors: [webConnector()] });`,
    );

    return;
  }

  const current = await getFileAsync(configPath);

  if (current.includes("webConnector")) {
    console.log(`${colors.yellowBright("webConnector")} already registered, skipping...`);

    return;
  }

  const importLine = 'import { webConnector } from "@warlock.js/web/connector";';
  let next = current.includes(importLine) ? current : `${importLine}\n${current}`;

  // An existing `connectors: [` gains one entry; otherwise the key is added to
  // the object `defineConfig` receives.
  if (/connectors:\s*\[/.test(next)) {
    next = next.replace(/connectors:\s*\[/, "connectors: [webConnector(),");
  } else if (next.includes("defineConfig({")) {
    next = next.replace("defineConfig({", "defineConfig({\n  connectors: [webConnector()],");
  } else {
    console.log(
      `${colors.yellowBright("warlock.config.ts")} has no recognisable defineConfig({...}) — ` +
        "add `connectors: [webConnector()]` yourself.",
    );

    return;
  }

  await putFileAsync(configPath, next);
  console.log(`${colors.green("✓")} Registered webConnector in warlock.config.ts`);
}

/**
 * The app routes file the project template registers `GET /` in. Only this one
 * path is inspected: `warlock add web` is not a codebase-wide route auditor, and
 * a project that keeps its routes elsewhere lands on the `absent` outcome below,
 * which writes the page exactly as before.
 */
const APP_ROUTES_FILE = "app/shared/routes.ts";

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

type HomeRouteCollision =
  /** No app routes file, or nothing claims `/` — write the page as normal. */
  | { outcome: "absent" }
  /** The template's `GET /` was moved to `/welcome`; the page is safe to write. */
  | { outcome: "relocated" }
  /** Something claims `/` that we will not rewrite. The page is NOT written. */
  | { outcome: "conflict"; reason: string }
  /** We tried to relocate and could not. The page is NOT written. */
  | { outcome: "failed"; reason: string };

/**
 * Make room for a page that declares `route = "/"`.
 *
 * The project template registers `router.get("/", homePageController)` and the
 * page stub declares `route = "/"`. Fastify rejects the second registration
 * (`Method 'GET' already declared for route '/'`) and the homepage 500s at
 * request time — so `warlock add web` cannot just write the page and hope.
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
async function relocateConflictingHomeRoute(): Promise<HomeRouteCollision> {
  const routesPath = srcPath(APP_ROUTES_FILE);

  // Not every project comes from the template. No file is not a problem.
  if (!(await fileExistsAsync(routesPath))) {
    return { outcome: "absent" };
  }

  let current: string;

  try {
    current = await getFileAsync(routesPath);
  } catch (error) {
    return {
      outcome: "failed",
      reason: `could not be read (${(error as Error).message})`,
    };
  }

  const matches = current.match(TOP_LEVEL_ROOT_GET) ?? [];

  if (matches.length === 0) {
    return { outcome: "absent" };
  }

  if (matches.length > 1) {
    return {
      outcome: "conflict",
      reason: `declares ${matches.length} top-level GET "/" routes`,
    };
  }

  if (TOP_LEVEL_WELCOME_GET.test(current)) {
    return {
      outcome: "conflict",
      reason: 'already declares GET "/welcome", so the usual relocation target is taken',
    };
  }

  const next = current.replace(TOP_LEVEL_ROOT_GET, (match, quote: string) =>
    match.replace(`${quote}/${quote}`, `${quote}/welcome${quote}`),
  );

  if (next === current) {
    return { outcome: "conflict", reason: 'its GET "/" route could not be rewritten' };
  }

  try {
    await putFileAsync(routesPath, next);
  } catch (error) {
    return {
      outcome: "failed",
      reason: `could not be written (${(error as Error).message})`,
    };
  }

  return { outcome: "relocated" };
}

/**
 * Scaffold the smallest page layer that renders, and register the connector.
 *
 * `src/web/root.tsx` is the sentinel for "already scaffolded" — the framework
 * ships a default root, so its presence means a human has been here.
 */
async function completeWebInstallation(_options: CommandActionData) {
  const rootFile = srcPath("web/root.tsx");

  if (await fileExistsAsync(rootFile)) {
    console.log(`${colors.yellowBright("src/web")} already scaffolded, skipping...`);
  } else {
    await ensureDirectoryAsync(srcPath("web"));
    await putFileAsync(rootFile, webRootStub);
    console.log(`${colors.green("✓")} Created src/web/root.tsx`);

    const collision = await relocateConflictingHomeRoute();

    if (collision.outcome === "relocated") {
      console.log(
        `${colors.green("✓")} Moved the existing ${colors.yellowBright('GET "/"')} route to ` +
          `${colors.yellowBright('"/welcome"')} in ${colors.yellowBright(`src/${APP_ROUTES_FILE}`)} — ` +
          "the new page owns `/` now, and the JSON welcome route still answers at /welcome.",
      );
    }

    // The page is written ONLY when `/` is provably free. Writing it while
    // another handler holds `/` produces a homepage that 500s on first request,
    // which is precisely the outcome a scaffolder must never hand back.
    if (collision.outcome === "conflict" || collision.outcome === "failed") {
      const verb = collision.outcome === "failed" ? colors.redBright("✗") : colors.yellowBright("!");

      console.log(
        `${verb} Did not create src/web/home.page.tsx: ` +
          `${colors.yellowBright(`src/${APP_ROUTES_FILE}`)} ${collision.reason}.\n` +
          `  The page stub declares ${colors.yellowBright('route = "/"')}, and two handlers on one ` +
          "path is a 500 at request time, not a startup error.\n" +
          `  Free up ${colors.yellowBright('GET "/"')} in that file — move it to a path of its own, ` +
          "or remove it — then create src/web/home.page.tsx yourself. Giving the page a `route` other " +
          "than `/` works too.",
      );

      // Non-zero on BOTH branches. The page layer this command exists to
      // scaffold was not scaffolded, and a 0 here is the exact "looked like it
      // worked" signal that put `/` in this state to begin with — a conflict we
      // declined to guess at is still an incomplete install, not a success.
      //
      // `exitCode` rather than `exit(1)`: the connector below still has to be
      // registered, and any other feature in the same `warlock add` invocation
      // still has to install, or the project is left half-wired on top of this.
      process.exitCode = 1;
    } else {
      await putFileAsync(srcPath("web/home.page.tsx"), webHomePageStub);
      console.log(`${colors.green("✓")} Created src/web/home.page.tsx`);
    }
  }

  await registerWebConnector();
}

export const webFeature: FeatureDefinition = {
  description:
    "Installs @warlock.js/web — SSR React pages served by the Warlock HTTP server. Scaffolds src/web (root.tsx + a home page) and registers the WebConnector in warlock.config.ts. Pages are opt-in: a Warlock app is an API until you add this.",
  dependencies: {
    "@warlock.js/web": "~4.0.0",
    react: "^19.2.3",
    "react-dom": "^19.2.3",
  },
  devDependencies: {
    "@types/react": "^19.2.7",
    "@types/react-dom": "^19.2.3",
    // Loaded through `await import()` by the dev server only, so both are
    // optional peers of `web` rather than hard dependencies.
    vite: "^7.3.5",
    "@vitejs/plugin-react": "^5.2.0",
  },
  onExecuting: completeWebInstallation,
};

import { colors } from "@mongez/copper";
import { ensureDirectoryAsync, fileExistsAsync, getFileAsync, putFileAsync } from "@warlock.js/fs";
import type { CommandActionData } from "../../commands/types";
import { rootPath, srcPath } from "../../utils";
import { relocateConflictingHomeRoute } from "./shared/relocate-conflicting-home-route";
import {
  webContactControllerStub,
  webContactRoutesStub,
  webHomePageStub,
  webHomeRegisterStub,
  webRootStub,
} from "../stubs";
import { type FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

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
          `${colors.yellowBright('"/welcome"')} in ${colors.yellowBright(`src/${collision.relativePath}`)} — ` +
          "the new page owns `/` now, and the JSON welcome route still answers at /welcome.",
      );
    }

    // The page is written ONLY when `/` is provably free. Writing it while
    // another handler holds `/` produces a homepage that 500s on first request,
    // which is precisely the outcome a scaffolder must never hand back.
    if (collision.outcome === "conflict" || collision.outcome === "failed") {
      const verb = collision.outcome === "failed" ? colors.redBright("✗") : colors.yellowBright("!");

      console.log(
        `${verb} Did not create src/web/index.page.tsx: ${collision.reason}.\n` +
          `  The page stub declares ${colors.yellowBright('route.path = "/"')}, and two handlers on one ` +
          "path is a 500 at request time, not a startup error.\n" +
          `  Free up ${colors.yellowBright('GET "/"')} under src/app — move it to a path of its own, ` +
          "or remove it — then create src/web/index.page.tsx yourself. Giving the page a `route` other " +
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
      await putFileAsync(srcPath("web/index.page.tsx"), webHomePageStub);
      await putFileAsync(srcPath("web/index.register.ts"), webHomeRegisterStub);
      await ensureDirectoryAsync(srcPath("app/contact/controllers"));
      await putFileAsync(
        srcPath("app/contact/controllers/contact.controller.ts"),
        webContactControllerStub,
      );
      await putFileAsync(srcPath("app/contact/routes.ts"), webContactRoutesStub);
      console.log(`${colors.green("✓")} Created src/web/index.page.tsx`);
      console.log(`${colors.green("✓")} Created POST /api/contact starter route`);
    }
  }

  await registerWebConnector();
}

export const webFeature: FeatureDefinition = {
  description:
    "Installs @warlock.js/web — SSR React pages served by the Warlock HTTP server. Scaffolds src/web (root.tsx + a home page) and registers the WebConnector in warlock.config.ts. Pages are opt-in: a Warlock app is an API until you add this.",
  dependencies: {
    "@warlock.js/web": INSTALLED_WARLOCK_VERSION,
    "@mongez/http": "^3.5.0",
    "@mongez/react-form": "^4.0.0",
    "@mongez/react-localization": "^3.4.7",
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

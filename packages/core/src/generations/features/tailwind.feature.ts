import { colors } from "@mongez/copper";
import {
  ensureDirectoryAsync,
  fileExistsAsync,
  getFileAsync,
  putFileAsync,
} from "@warlock.js/fs";
import { CommandActionData } from "../../commands/types";
import { rootPath, srcPath } from "../../utils";
import { FeatureDefinition } from "./types";

/**
 * The stylesheet entry, and the whole of Tailwind's configuration.
 *
 * Tailwind v4 is CSS-first: there is no `tailwind.config.js` and no `content`
 * globs to keep in sync with the project layout — the engine discovers the
 * templates that reach it through the bundler graph, and everything a v3 config
 * held (`theme`, `plugins`, `darkMode`) is expressed in CSS beside the import.
 * So this one file is the config, which is why the feature writes it rather
 * than an `ejectConfig` entry: `ejectConfig` lands in `src/config/*.ts`, and a
 * stylesheet that must sit in the bundler's path does not belong there.
 */
const appCssStub = `@import "tailwindcss";

/*
  Tailwind v4 configures itself from CSS — there is no tailwind.config.js.

  Design tokens go in an @theme block, and each one becomes both a CSS variable
  and a utility class:

    @theme {
      --color-brand: oklch(0.62 0.19 259);
      --font-display: "Inter", sans-serif;
    }

  gives you \`bg-brand\`, \`text-brand\`, \`font-display\` and \`var(--color-brand)\`.

  Plugins are imported here too — \`@plugin "@tailwindcss/typography";\` — and
  your own non-utility CSS can simply follow this comment.
*/
`;

/**
 * PostCSS rather than a Vite config file, and deliberately at the project root.
 *
 * Vite discovers `postcss.config.mjs` from the project root on its own, in the
 * dev server and in `vite build` alike, without the application owning a Vite
 * config at all. That matters here: the only app-facing Vite plugin array in
 * this framework is `webConnector({ plugins })`, which is wired into the DEV
 * server exclusively — the client build composes its own plugin list from its
 * caller. Registering `@tailwindcss/vite` there would produce styles in `dev`
 * and silently drop them from a production build, which is a worse failure than
 * any config file, because it only shows up after deploy.
 *
 * `.mjs` because a Warlock project's `package.json` is not guaranteed to set
 * `"type": "module"`, and `export default` in a `.js` file would throw in a
 * CommonJS project.
 */
const postcssConfigStub = `/**
 * Tailwind v4 runs as a PostCSS plugin. Vite loads this file automatically —
 * in dev and in build — so no Vite configuration is required.
 *
 * The plugin lives in its own package in v4: \`tailwindcss\` is the engine,
 * \`@tailwindcss/postcss\` is the adapter. Naming \`tailwindcss\` here directly is
 * the v3 spelling and will not work.
 */
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
`;

/**
 * Every filename Vite/PostCSS will pick up from the project root.
 *
 * Checked as a set rather than just writing our own: two PostCSS configs in one
 * directory is not a merge, it is a coin toss over which one loads, so a project
 * that already has one gets instructions instead of a second file.
 */
const POSTCSS_CONFIG_FILES = [
  "postcss.config.mjs",
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.ts",
  "postcss.config.json",
  ".postcssrc",
  ".postcssrc.js",
  ".postcssrc.json",
];

/** The side-effect import that pulls the stylesheet into the bundler graph. */
const APP_CSS_IMPORT = 'import "./app.css";';

/**
 * Create `src/web/app.css` — the sentinel for "this feature already ran".
 *
 * Nothing in the project template creates this file (the scaffold ships a
 * static `public/home.css` instead), so its presence means `add tailwind` has
 * been here, and its contents may since have been edited into a real design
 * system. It is never rewritten.
 */
async function createStylesheet(): Promise<boolean> {
  const cssFile = srcPath("web/app.css");

  if (await fileExistsAsync(cssFile)) {
    console.log(`${colors.yellowBright("src/web/app.css")} already exists, skipping...`);

    return false;
  }

  await ensureDirectoryAsync(srcPath("web"));
  await putFileAsync(cssFile, appCssStub);
  console.log(`${colors.green("✓")} Created src/web/app.css`);

  return true;
}

/**
 * Write `postcss.config.mjs`, unless the project already has a PostCSS config.
 *
 * An existing config is left completely alone. It is an app-owned build file
 * that may already register autoprefixer, nesting, or a CSS-modules pass, and
 * appending Tailwind to it by string surgery would be guessing at both its
 * module format and its plugin order.
 */
async function writePostcssConfig(): Promise<void> {
  for (const name of POSTCSS_CONFIG_FILES) {
    if (!(await fileExistsAsync(rootPath(name)))) continue;

    const current = await getFileAsync(rootPath(name)).catch(() => "");

    if (current.includes("@tailwindcss/postcss")) {
      console.log(`${colors.yellowBright(name)} already registers Tailwind, skipping...`);
    } else {
      console.log(
        `${colors.yellowBright("!")} ${colors.yellowBright(name)} already exists — add Tailwind to it yourself:\n` +
          `  plugins: { "@tailwindcss/postcss": {} }\n` +
          "  Two PostCSS configs in one project is undefined behaviour, so this feature did not write a second one.",
      );
    }

    return;
  }

  await putFileAsync(rootPath("postcss.config.mjs"), postcssConfigStub);
  console.log(`${colors.green("✓")} Created postcss.config.mjs`);
}

/**
 * Import the stylesheet from `src/web/root.tsx`.
 *
 * The root is the one module every SSR page renders through, so importing the
 * stylesheet there is what puts it in the client bundle for every route.
 *
 * `root.tsx` is guaranteed to exist by the time this runs: `requires: ["web"]`
 * makes the add command resolve `web` ahead of `tailwind` and run its
 * `onExecuting` first, and that is what creates the file. The check below is
 * therefore for a root a human has since moved or deleted — a case worth a
 * printed instruction, not a failure.
 */
async function importStylesheetFromRoot(): Promise<void> {
  const rootFile = srcPath("web/root.tsx");

  if (!(await fileExistsAsync(rootFile))) {
    console.log(
      `${colors.yellowBright("!")} ${colors.yellowBright("src/web/root.tsx")} not found — ` +
        `add ${colors.yellowBright(APP_CSS_IMPORT)} to your application root yourself.\n` +
        "  Until the stylesheet is imported from a module the bundler reaches, no Tailwind CSS is emitted.",
    );

    return;
  }

  const current = await getFileAsync(rootFile);

  // Matches the import whichever quote style and specifier the file uses, so a
  // re-run against a hand-edited root does not stack a second copy.
  if (/import\s+["'].*app\.css["']/.test(current)) {
    console.log(`${colors.yellowBright("src/web/root.tsx")} already imports app.css, skipping...`);

    return;
  }

  // FIRST line, above the framework imports. A side-effect CSS import has no
  // binding to order against, and putting it at the top keeps it from being
  // swept away by an import sorter that only ranks module specifiers.
  await putFileAsync(rootFile, `${APP_CSS_IMPORT}\n${current}`);
  console.log(`${colors.green("✓")} Imported app.css in src/web/root.tsx`);
}

/**
 * Wire Tailwind v4 into the page layer.
 *
 * Three files, none of which needs `node_modules` to be populated: on the
 * `create-warlock` path this runs under `--no-install`, so the dependencies
 * declared below are only recorded in `package.json` and nothing here may
 * import, resolve, or execute Tailwind itself.
 */
async function completeTailwindInstallation(_options: CommandActionData) {
  await createStylesheet();
  await writePostcssConfig();
  await importStylesheetFromRoot();
}

export const tailwindFeature: FeatureDefinition = {
  description:
    "Installs Tailwind CSS v4 for the SSR page layer. Creates src/web/app.css (the CSS-first config — v4 has no tailwind.config.js), imports it from src/web/root.tsx, and registers the engine through postcss.config.mjs, which Vite loads in dev and build alike.",
  // `web` owns root.tsx and the CSS pipeline that serves this stylesheet.
  // Requiring it also fixes the order: the add command resolves requirements
  // depth-first, so `web` scaffolds src/web before this feature writes into it.
  requires: ["web"],
  devDependencies: {
    // Build-time only, both of them — Tailwind compiles to a plain stylesheet
    // and nothing it ships is imported at runtime.
    tailwindcss: "^4.1.16",
    // The engine and its PostCSS adapter are separate packages in v4 and are
    // released in lockstep; keep these two ranges identical.
    "@tailwindcss/postcss": "^4.1.16",
  },
  onExecuting: completeTailwindInstallation,
};

import { colors } from "@mongez/copper";
import { dirname } from "node:path";
import payload from "../design-system-mantine-payload.json" with { type: "json" };
import {
  ensureDirectoryAsync,
  fileExistsAsync,
  getFileAsync,
  putFileAsync,
  recordSkippedFile,
} from "../generation-fs";
import { rootPath, srcPath } from "../../utils";
import { assertUiKitFree } from "./shared/ui-kit";
import type { FeatureDefinition } from "./types";

/** Marks a stylesheet that already pulls in Mantine's CSS, whatever else it holds. */
const MANTINE_CSS_MARKER = "@mantine/core/styles.css";

const mantineCssImports = `@import "${MANTINE_CSS_MARKER}";
@import "@mantine/dates/styles.css";
@import "@mantine/notifications/styles.css";
`;

/**
 * PostCSS carries Mantine's CSS authoring features (rem(), light-dark(),
 * mixins, breakpoint variables). Vite finds this file from the project root in
 * dev and in build, the same way it finds a Tailwind config.
 */
const postcssConfigStub = `/**
 * Mantine's PostCSS preset. Vite loads this file automatically, in dev and in
 * build. The breakpoints match Mantine's defaults; keep them in sync with the
 * theme if you change either.
 */
export default {
  plugins: {
    "postcss-preset-mantine": {},
    "postcss-simple-vars": {
      variables: {
        "mantine-breakpoint-xs": "36em",
        "mantine-breakpoint-sm": "48em",
        "mantine-breakpoint-md": "62em",
        "mantine-breakpoint-lg": "75em",
        "mantine-breakpoint-xl": "88em",
      },
    },
  },
};
`;

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

async function writePostcssConfig(): Promise<void> {
  for (const name of POSTCSS_CONFIG_FILES) {
    if (!(await fileExistsAsync(rootPath(name)))) continue;

    const current = await getFileAsync(rootPath(name)).catch(() => "");

    if (current.includes("postcss-preset-mantine")) {
      console.log(`${colors.yellowBright(name)} already registers Mantine, skipping...`);
    } else {
      console.log(
        `${colors.yellowBright("!")} ${colors.yellowBright(name)} already exists, add Mantine to it yourself:\n` +
          '  plugins: { "postcss-preset-mantine": {}, "postcss-simple-vars": { variables: { ... } } }\n' +
          "  Two PostCSS configs in one project is undefined behaviour, so no second one was written.",
      );
    }

    return;
  }

  await putFileAsync(rootPath("postcss.config.mjs"), postcssConfigStub);
  console.log(`${colors.green("✓")} Created postcss.config.mjs`);
}

/** Create `src/web/app.css`, or put Mantine's imports at the top of the one that exists. */
async function writeStylesheet(): Promise<void> {
  const cssFile = srcPath("web/app.css");

  if (!(await fileExistsAsync(cssFile))) {
    await ensureDirectoryAsync(srcPath("web"));
    await putFileAsync(cssFile, mantineCssImports);
    console.log(`${colors.green("✓")} Created src/web/app.css`);
    return;
  }

  const current = await getFileAsync(cssFile);

  if (current.includes(MANTINE_CSS_MARKER)) {
    console.log(`${colors.yellowBright("src/web/app.css")} already imports Mantine, skipping...`);
    return;
  }

  // `@import` rules only count before any other rule, so they go first.
  await putFileAsync(cssFile, `${mantineCssImports}${current}`);
  console.log(`${colors.green("✓")} Added Mantine's CSS imports to src/web/app.css`);
}

const providerImport =
  'import DesignSystemProvider, { DesignSystemColorScheme } from "./design-system/provider";';
const mantineImport = 'import { mantineHtmlProps } from "@mantine/core";';
const manualRootSteps =
  '  1. import "./app.css";\n' +
  `  2. ${mantineImport}\n` +
  `  3. ${providerImport}\n` +
  "  4. <html ... {...mantineHtmlProps}>\n" +
  "  5. <DesignSystemColorScheme /> inside <head>, after <Head />\n" +
  '  6. <DesignSystemProvider> around <div id="vessel">{children}</div>';

/**
 * Wire the Mantine pieces into `src/web/root.tsx`: the stylesheet, the colour
 * scheme script, the `<html>` hydration props and the provider. Every edit is a
 * guarded string replacement, so a root a human has reshaped gets printed
 * instructions rather than a guess.
 */
async function wireRoot(): Promise<void> {
  const rootFile = srcPath("web/root.tsx");

  if (!(await fileExistsAsync(rootFile))) {
    console.log(
      `${colors.yellowBright("!")} src/web/root.tsx not found, wire Mantine into your root yourself:\n${manualRootSteps}`,
    );
    return;
  }

  let next = await getFileAsync(rootFile);

  if (next.includes("DesignSystemProvider")) {
    console.log(`${colors.yellowBright("src/web/root.tsx")} already mounts Mantine, skipping...`);
    return;
  }

  const hasHtml = /<html\b[^>]*>/.test(next);
  const hasHead = next.includes("<Head />");
  const hasVessel = next.includes('<div id="vessel">{children}</div>');

  if (!hasHtml || !hasHead || !hasVessel) {
    console.log(
      `${colors.yellowBright("!")} src/web/root.tsx has a custom shape, wire Mantine into it yourself:\n${manualRootSteps}`,
    );
    return;
  }

  next = next
    .replace(/<html\b([^>]*)>/, "<html$1 {...mantineHtmlProps}>")
    .replace("<Head />", "<Head />\n        <DesignSystemColorScheme />")
    .replace(
      '<div id="vessel">{children}</div>',
      '<DesignSystemProvider>\n          <div id="vessel">{children}</div>\n        </DesignSystemProvider>',
    );

  const imports = [`${mantineImport}`, providerImport];
  if (!/import\s+["'].*app\.css["']/.test(next)) imports.push('import "./app.css";');

  // After the last top-level import statement, or first when there is none.
  const statements = [...next.matchAll(/^import\b[^;]*;[ \t]*\r?\n/gm)];
  const last = statements.at(-1);
  const at = last ? (last.index ?? 0) + last[0].length : 0;

  await putFileAsync(rootFile, `${next.slice(0, at)}${imports.join("\n")}\n${next.slice(at)}`);
  console.log(`${colors.green("✓")} Mounted MantineProvider in src/web/root.tsx`);
}

async function writePayloadFiles(): Promise<void> {
  for (const [relativePath, content] of Object.entries(payload.files)) {
    const target = rootPath(relativePath);

    if (await fileExistsAsync(target)) {
      recordSkippedFile(target, "exists");
      continue;
    }

    await ensureDirectoryAsync(dirname(target));
    await putFileAsync(target, content);
  }
}

export const mantineFeature: FeatureDefinition = {
  description:
    "Mantine UI kit wired to Mongez React Form: the same design-system components, hooks and error display as the shadcn kit, plus notify, confirm and PaginatedTable. Does not need Tailwind. Same as `warlock add design-system --kit mantine`.",
  requires: ["web"],
  dependencies: payload.dependencies,
  devDependencies: payload.devDependencies,
  async onExecuting() {
    await assertUiKitFree("mantine");
    await writePostcssConfig();
    await writeStylesheet();
    await wireRoot();
    await writePayloadFiles();
    console.log(
      "Mantine controls are ready in src/web/design-system. Edit the theme in src/web/design-system/mantine-theme.ts. Existing files were preserved.",
    );
  },
};

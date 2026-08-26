import { colors } from "@mongez/copper";
import { ensureDirectoryAsync, fileExistsAsync, getFileAsync, putFileAsync } from "@warlock.js/fs";
import { CommandActionData } from "../../commands/types";
import { rootPath, srcPath } from "../../utils";
import { FeatureDefinition } from "./types";

/**
 * `warlock add shadcn` installs the PREREQUISITES for shadcn/ui. It does not
 * wrap `shadcn add`, and it never will.
 *
 * shadcn/ui is a copy-in generator with its own CLI and its own registry, not a
 * dependency: components are written into your source tree and become yours the
 * moment they land. Wrapping their CLI would make their moving target our bug
 * reports, for a command that adds nothing but a rename.
 *
 * What is worth owning is the part their CLI gets wrong here. Measured against
 * this framework's layout on 2026-08-25, `shadcn add button card` exited 0 and
 * produced components that rendered COMPLETELY UNSTYLED. It writes components
 * that import `cn` and reference `bg-primary` / `ring-ring`, but only
 * `shadcn init` creates `lib/utils` and the theme tokens those names resolve
 * against. The class was in the generated CSS and the element carried it, and
 * the rule still evaluated to an empty `var()` — a silent failure with a zero
 * exit code, which is the worst kind to hand a user.
 *
 * So this feature ships the five things that make `npx shadcn add <component>`
 * work the first time:
 *
 *   1. `components.json` written for OUR layout (their defaults assume `src/app`
 *      or a bare `components/`, neither of which is where pages live here).
 *   2. `src/web/lib/utils.ts` exporting `cn`.
 *   3. The design tokens appended to `src/web/app.css`.
 *   4. A `web/*` entry in tsconfig `paths`, so the generated imports typecheck.
 *   5. The packages `init` would have installed — see `printNextStep` below.
 *      Skipping `init` is correct; skipping its dependency list was a bug, and
 *      it cost a generated button that imports `cva` and cannot compile.
 *
 * After that, the user talks to shadcn directly, and their docs are true.
 */

/**
 * The aliases shadcn's CLI rewrites every generated import against.
 *
 * These are the whole reason this feature exists. shadcn's defaults do not fit
 * `src/web`, and no user would guess this mapping: the alias keys are shadcn's
 * vocabulary, the values are tsconfig `paths` prefixes (hence `web/...`, not
 * `src/web/...`), and `tailwind.css` is a real path from the project root
 * (hence `src/web/app.css`, WITH the `src`). Getting one of them wrong produces
 * components in the wrong folder importing `cn` from somewhere that does not
 * exist.
 *
 * `tailwind.config` is deliberately empty: v4 is CSS-first and there is no
 * config file for it to point at. `rsc: false` because these are SSR React
 * pages rendered by the Warlock HTTP server, not React Server Components.
 */
const componentsJsonStub = `{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/web/app.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "web/components",
    "utils": "web/lib/utils",
    "ui": "web/components/ui",
    "lib": "web/lib",
    "hooks": "web/hooks"
  },
  "iconLibrary": "lucide"
}
`;

/**
 * `cn` — the one import every single shadcn component makes.
 *
 * `clsx` resolves the conditional/array/object class syntax, and `tailwind-merge`
 * then de-duplicates conflicting Tailwind utilities so a caller's `className`
 * actually beats the component's own default rather than depending on which one
 * happens to come later in the generated stylesheet. Both halves are required:
 * clsx alone leaves `px-2 px-4` in the attribute and the loser wins at random.
 */
const cnUtilStub = `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names, with later Tailwind utilities winning over earlier ones.
 *
 * Every shadcn/ui component imports this. Keep the export name and signature.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

/**
 * Marker for "the tokens are already in this stylesheet".
 *
 * A comment rather than a token name, because a user is free to retune every
 * value below and we must still recognise our own block on a re-run.
 */
const SHADCN_TOKENS_MARKER = "shadcn/ui design tokens";

/**
 * The shadcn token set, as a plain `@theme` block with LITERAL values.
 *
 * Not `@theme inline` over `:root` custom properties, which is what shadcn's own
 * `init` writes. That form was verified against this stylesheet pipeline on
 * 2026-08-25 and it produces utilities that resolve to nothing: the class is in
 * the generated CSS, the class is on the element, and the rule still evaluates
 * to an empty `var()`. Literal values in `@theme` are what make `bg-primary`
 * emit a colour instead of a dangling reference.
 *
 * Dark mode still works, and works the way shadcn expects: `@theme` emits these
 * as real custom properties, so the `.dark` block re-declares the same
 * `--color-*` names and the cascade does the rest. `@custom-variant dark` is
 * what points Tailwind's `dark:` prefix at that class instead of the OS setting.
 *
 * Values are shadcn's `neutral` base. They are the starting point, not the
 * answer — this is the block to edit when the project gets a real palette.
 */
const shadcnTokensStub = `
/* ${SHADCN_TOKENS_MARKER} — edit freely, this is your palette now.

   These are LITERAL values in a plain @theme block, on purpose. shadcn's own
   \`init\` writes \`@theme inline\` over :root custom properties; that form emits
   utilities which resolve to an empty var() here, so every component renders
   unstyled while the class sits right there on the element. Do not convert it.
*/
@custom-variant dark (&:is(.dark *));

@theme {
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.145 0 0);
  --color-card: oklch(1 0 0);
  --color-card-foreground: oklch(0.145 0 0);
  --color-popover: oklch(1 0 0);
  --color-popover-foreground: oklch(0.145 0 0);
  --color-primary: oklch(0.205 0 0);
  --color-primary-foreground: oklch(0.985 0 0);
  --color-secondary: oklch(0.97 0 0);
  --color-secondary-foreground: oklch(0.205 0 0);
  --color-muted: oklch(0.97 0 0);
  --color-muted-foreground: oklch(0.556 0 0);
  --color-accent: oklch(0.97 0 0);
  --color-accent-foreground: oklch(0.205 0 0);
  --color-destructive: oklch(0.577 0.245 27.325);
  --color-destructive-foreground: oklch(0.985 0 0);
  --color-border: oklch(0.922 0 0);
  --color-input: oklch(0.922 0 0);
  --color-ring: oklch(0.708 0 0);

  --color-chart-1: oklch(0.646 0.222 41.116);
  --color-chart-2: oklch(0.6 0.118 184.704);
  --color-chart-3: oklch(0.398 0.07 227.392);
  --color-chart-4: oklch(0.828 0.189 84.429);
  --color-chart-5: oklch(0.769 0.188 70.08);

  --color-sidebar: oklch(0.985 0 0);
  --color-sidebar-foreground: oklch(0.145 0 0);
  --color-sidebar-primary: oklch(0.205 0 0);
  --color-sidebar-primary-foreground: oklch(0.985 0 0);
  --color-sidebar-accent: oklch(0.97 0 0);
  --color-sidebar-accent-foreground: oklch(0.205 0 0);
  --color-sidebar-border: oklch(0.922 0 0);
  --color-sidebar-ring: oklch(0.708 0 0);

  /* shadcn components reach for rounded-lg/md/sm and expect them to track one
     radius. Changing --radius-lg here also retunes Tailwind's own rounded-lg,
     which is the intended trade: one radius scale per project, not two. */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.625rem;
  --radius-xl: 1rem;
}

.dark {
  --color-background: oklch(0.145 0 0);
  --color-foreground: oklch(0.985 0 0);
  --color-card: oklch(0.205 0 0);
  --color-card-foreground: oklch(0.985 0 0);
  --color-popover: oklch(0.205 0 0);
  --color-popover-foreground: oklch(0.985 0 0);
  --color-primary: oklch(0.922 0 0);
  --color-primary-foreground: oklch(0.205 0 0);
  --color-secondary: oklch(0.269 0 0);
  --color-secondary-foreground: oklch(0.985 0 0);
  --color-muted: oklch(0.269 0 0);
  --color-muted-foreground: oklch(0.708 0 0);
  --color-accent: oklch(0.269 0 0);
  --color-accent-foreground: oklch(0.985 0 0);
  --color-destructive: oklch(0.704 0.191 22.216);
  --color-destructive-foreground: oklch(0.985 0 0);
  --color-border: oklch(1 0 0 / 10%);
  --color-input: oklch(1 0 0 / 15%);
  --color-ring: oklch(0.556 0 0);

  --color-chart-1: oklch(0.488 0.243 264.376);
  --color-chart-2: oklch(0.696 0.17 162.48);
  --color-chart-3: oklch(0.769 0.188 70.08);
  --color-chart-4: oklch(0.627 0.265 303.9);
  --color-chart-5: oklch(0.645 0.246 16.439);

  --color-sidebar: oklch(0.205 0 0);
  --color-sidebar-foreground: oklch(0.985 0 0);
  --color-sidebar-primary: oklch(0.488 0.243 264.376);
  --color-sidebar-primary-foreground: oklch(0.985 0 0);
  --color-sidebar-accent: oklch(0.269 0 0);
  --color-sidebar-accent-foreground: oklch(0.985 0 0);
  --color-sidebar-border: oklch(1 0 0 / 10%);
  --color-sidebar-ring: oklch(0.556 0 0);
}
`;

/**
 * Write `components.json` — the sentinel for "this feature already ran".
 *
 * Nothing in the project template creates this file, so its presence means
 * `add shadcn` has been here and a human may since have retuned the aliases,
 * the style, or the base colour. It is never rewritten: shadcn's CLI reads this
 * file on every `add`, so overwriting it would silently relocate a project's
 * component folder out from under the components already in it.
 */
async function writeComponentsJson(): Promise<void> {
  const componentsJsonPath = rootPath("components.json");

  if (await fileExistsAsync(componentsJsonPath)) {
    console.log(`${colors.yellowBright("components.json")} already exists, skipping...`);

    return;
  }

  await putFileAsync(componentsJsonPath, componentsJsonStub);
  console.log(`${colors.green("✓")} Created components.json`);
}

/**
 * Write `src/web/lib/utils.ts`.
 *
 * Guarded on its own rather than on the sentinel above, because `lib/utils` is
 * a name a project may well already own — and if it does, whatever is in there
 * is user code with other callers. We print instead of merging.
 */
async function writeCnUtil(): Promise<void> {
  const utilsFile = srcPath("web/lib/utils.ts");

  if (await fileExistsAsync(utilsFile)) {
    const current = await getFileAsync(utilsFile).catch(() => "");

    if (/export\s+(function|const)\s+cn\b/.test(current)) {
      console.log(`${colors.yellowBright("src/web/lib/utils.ts")} already exports cn, skipping...`);
    } else {
      console.log(
        `${colors.yellowBright("!")} ${colors.yellowBright("src/web/lib/utils.ts")} exists but does not export ` +
          `${colors.yellowBright("cn")} — add it yourself:\n` +
          "  export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }\n" +
          "  Every shadcn component imports it, and none of them will compile until it is there.",
      );
    }

    return;
  }

  await ensureDirectoryAsync(srcPath("web/lib"));
  await putFileAsync(utilsFile, cnUtilStub);
  console.log(`${colors.green("✓")} Created src/web/lib/utils.ts`);
}

/**
 * Append the token block to `src/web/app.css`.
 *
 * The stylesheet is guaranteed to exist by the time this runs: `requires:
 * ["tailwind"]` makes the add command resolve `tailwind` first and run its
 * `onExecuting` ahead of this one, and that is what creates the file. The check
 * below is for a stylesheet a human has since moved or deleted — worth a
 * printed instruction, not a failure.
 *
 * Appended, never rewritten. Everything already in that file is either
 * Tailwind's own `@import` or the project's design system.
 */
async function appendThemeTokens(): Promise<void> {
  const cssFile = srcPath("web/app.css");

  if (!(await fileExistsAsync(cssFile))) {
    console.log(
      `${colors.yellowBright("!")} ${colors.yellowBright("src/web/app.css")} not found — ` +
        "append the shadcn token block to your Tailwind stylesheet yourself.\n" +
        "  Without the tokens, shadcn components render unstyled: the classes are emitted and applied, " +
        "but `bg-primary` and friends resolve to an empty var().",
    );

    return;
  }

  const current = await getFileAsync(cssFile);

  if (current.includes(SHADCN_TOKENS_MARKER) || current.includes("--color-primary-foreground")) {
    console.log(`${colors.yellowBright("src/web/app.css")} already has the tokens, skipping...`);

    return;
  }

  await putFileAsync(cssFile, `${current.trimEnd()}\n${shadcnTokensStub}`);
  console.log(`${colors.green("✓")} Appended the shadcn tokens to src/web/app.css`);
}

/** The tsconfig `paths` entry the generated imports resolve through. */
const WEB_PATH_ALIAS = '"web/*": ["./src/web/*"]';

/**
 * Add `web/*` to tsconfig `compilerOptions.paths`.
 *
 * The template declares only `app/*`, so every import shadcn generates against
 * the aliases above (`web/lib/utils`, `web/components/ui/button`) would fail to
 * typecheck the moment it lands. This is the first `add` feature to patch
 * `paths` rather than `include`.
 *
 * String surgery, and NOT the parse-and-write that the `include` patches use.
 * The project template's `tsconfig.json` carries `//` comments — it is JSONC,
 * and `JSON.parse` throws on it — so a parse-first patch would fail on exactly
 * the projects this feature is for. Editing the text also preserves those
 * comments, which are load-bearing documentation in that file.
 */
async function addWebPathAlias(): Promise<void> {
  const tsconfigPath = rootPath("tsconfig.json");

  const printManualInstruction = (reason: string) => {
    console.log(
      `${colors.yellowBright("!")} ${colors.yellowBright("tsconfig.json")} ${reason} — ` +
        "add this to `compilerOptions.paths` yourself:\n" +
        `  ${WEB_PATH_ALIAS}\n` +
        "  Without it, every import shadcn generates against the `web/*` aliases fails to typecheck.",
    );
  };

  if (!(await fileExistsAsync(tsconfigPath))) {
    printManualInstruction("not found");

    return;
  }

  const current = await getFileAsync(tsconfigPath);

  // Matches the alias whichever quote style and spacing the file uses, so a
  // re-run against a hand-edited tsconfig does not stack a second entry.
  if (/["']web\/\*["']\s*:/.test(current)) {
    console.log(`${colors.yellowBright("tsconfig.json")} already maps web/*, skipping...`);

    return;
  }

  let next: string;

  if (/"paths"\s*:\s*\{/.test(current)) {
    next = current.replace(/"paths"\s*:\s*\{/, `$&\n      ${WEB_PATH_ALIAS},`);
  } else if (/"compilerOptions"\s*:\s*\{/.test(current)) {
    next = current.replace(
      /"compilerOptions"\s*:\s*\{/,
      `$&\n    "paths": {\n      ${WEB_PATH_ALIAS}\n    },`,
    );
  } else {
    printManualInstruction("has no recognisable compilerOptions block");

    return;
  }

  await putFileAsync(tsconfigPath, next);
  console.log(`${colors.green("✓")} Added ${WEB_PATH_ALIAS} to tsconfig.json paths`);
}

/**
 * Tell the user the next command is theirs to run.
 *
 * This is the seam. Everything above is prerequisite; from here the shadcn docs
 * apply verbatim, which is the entire point of not wrapping their CLI.
 *
 * WHY THIS FEATURE DECLARES cva AND lucide-react, and where the list came from.
 *
 * shadcn's registry splits dependencies across two levels. Each component item
 * (`.../new-york-v4/button.json`) declares only what that file pulls beyond the
 * baseline — for button, `radix-ui` and nothing else. Everything the baseline
 * assumes lives on the STYLE INDEX (`.../new-york-v4/index.json`), which is
 * fetched by `init` and only by `init`:
 *
 *   dependencies:    class-variance-authority, lucide-react, radix-ui
 *   devDependencies: tw-animate-css, shadcn
 *
 * We skip `init` on purpose — it would rewrite components.json and replace the
 * literal tokens with the `@theme inline` block that resolves to nothing here.
 * Skipping it is right; inheriting nothing from it was the bug. `shadcn add
 * button` exits 0 and writes `import { cva } from "class-variance-authority"`
 * against a package no one installed. Zero exit code, TS2307, blank page.
 *
 * `radix-ui` stays off our list: it is the one style-index dependency that is
 * ALSO declared per-component, so `add` really does install it on demand, and
 * declaring it here would pull the whole primitive set into projects using two
 * components. `shadcn` itself stays off too — it is the CLI, and the user is
 * invoking it via `npx`.
 *
 * `tw-animate-css` was checked and deliberately EXCLUDED. It is not imported by
 * any component; it is a plain stylesheet whose only entry point is the
 * `@import "tw-animate-css"` line that `init` writes into the CSS — and we do
 * not write that line, so the package would install and never load. Nothing
 * fails to compile or render without it. What you lose is the enter/exit
 * animation on overlay components (dialog, dropdown, tooltip, sheet): their
 * `animate-in` / `fade-in-0` classes are simply never generated, so the overlay
 * appears instantly instead of fading. That is opt-in, and the note below is how
 * a user opts in — the `@import` has to go at the TOP of app.css, next to
 * Tailwind's own, which is why this feature cannot append it to the token block.
 */
function printNextStep(): void {
  console.log(
    `\n${colors.green("✓")} shadcn/ui prerequisites are in place. Add components with shadcn's own CLI:\n` +
      `  ${colors.yellowBright("npx shadcn@latest add button card")}\n` +
      "  Skip `shadcn init` — this feature did its job, and running it would rewrite components.json\n" +
      "  and replace the theme tokens with an `@theme inline` block that resolves to nothing here.\n" +
      `  ${colors.yellowBright("class-variance-authority")} and ${colors.yellowBright("lucide-react")} are already installed: shadcn declares\n` +
      "  them on the style index that only `init` reads, so `add` would never install them for you.\n" +
      `  ${colors.yellowBright("radix-ui")} (the unified package, not @radix-ui/react-*) IS declared per component,\n` +
      "  so shadcn's CLI installs that one itself as each component needs it.\n" +
      `  For overlay animations, add ${colors.yellowBright("tw-animate-css")} and put ${colors.yellowBright('@import "tw-animate-css";')}\n` +
      "  at the TOP of src/web/app.css, under the Tailwind import. Without it dialogs and dropdowns\n" +
      "  still work, they just appear instantly instead of animating.",
  );
}

/**
 * Lay the ground shadcn's CLI expects to find, and nothing more.
 *
 * Four files, none of which needs `node_modules` to be populated: on the
 * `create-warlock` path this runs under `--no-install`, so the dependencies
 * declared below are only recorded in `package.json` and nothing here may
 * import, resolve, or execute shadcn, clsx, or Tailwind.
 */
async function completeShadcnInstallation(_options: CommandActionData) {
  await writeComponentsJson();
  await writeCnUtil();
  await appendThemeTokens();
  await addWebPathAlias();
  printNextStep();
}

export const shadcnFeature: FeatureDefinition = {
  description:
    "Sets up the prerequisites for shadcn/ui so `npx shadcn add <component>` works first time: components.json aliased to src/web, src/web/lib/utils.ts (cn), the design tokens in src/web/app.css, and a web/* tsconfig path. It does NOT wrap shadcn's CLI — components stay theirs to generate and yours to own.",
  // `tailwind` owns src/web/app.css, which the token block is appended to.
  // Requiring it also fixes the order: the add command resolves requirements
  // depth-first, so the stylesheet exists before this feature writes into it.
  requires: ["tailwind"],
  // Everything `shadcn init` would have installed, minus the parts their CLI
  // genuinely does install per-component. See the note above `printNextStep`
  // for how this list was derived and what is deliberately NOT in it.
  dependencies: {
    // Both are runtime dependencies of `cn`, which every generated component
    // calls on every render — not build-time tooling.
    clsx: "^2.1.1",
    // v3 is the Tailwind v4 line; tailwind-merge v2 knows the v3 utility set and
    // silently fails to de-duplicate against v4 class names.
    "tailwind-merge": "^3.3.1",
    // `cva` is imported on line 2 of the generated button — and of every other
    // component with a `variant` prop. The registry declares it ONCE, on the
    // style index that only `init` applies, so `shadcn add button` resolves the
    // component's own deps, exits 0, and leaves TS2307 on a file it just wrote.
    // Still 0.x upstream, so this caret pins to 0.7.x; expect 0.7.1 to land.
    "class-variance-authority": "^0.7.1",
    // Same trap, one layer further in. `components.json` declares
    // `iconLibrary: "lucide"`, and dialog/select/checkbox/dropdown-menu all
    // import `lucide-react` in their source while declaring only `radix-ui` —
    // verified against the new-york-v4 registry items. So the CLI installs it
    // for nobody, and the first icon-bearing component fails to resolve.
    // Peer range covers React 19, which is what `web` brings.
    "lucide-react": "^1.34.0",
  },
  onExecuting: completeShadcnInstallation,
};

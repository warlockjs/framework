/**
 * Project settings: `grimoire/settings.md`, a front-matter-only written file
 * (the same grammar as every other written file), read once per snapshot.
 *
 * ```md
 * ---
 * languages: [en, ar]
 * screenshots: changed
 * rules: [logical-css, specific-errors, type-discriminator, no-js-imports]
 * protected:
 *   - payments src/app/payments/** src/config/payments.ts
 * ---
 * ```
 *
 * Every key is optional; a project without the file gets
 * {@link DEFAULT_GRIMOIRE_SETTINGS} (with the adapter's languages).
 */

import type { Located, SourceLocation } from "./location";

/**
 * When `@shows` scenes capture screenshots:
 * - `changed`: only the flows of the features the change touches (git diff against the base);
 * - `all`: every `@shows` scene (run this before a release);
 * - `off`: no scene runs and nothing is captured.
 */
export type ScreenshotMode = "changed" | "all" | "off";

/** Every screenshot mode, in the order the docs list them. */
export const SCREENSHOT_MODES: readonly ScreenshotMode[] = ["changed", "all", "off"];

/**
 * A code rule: a repeated correction turned into a check.
 * - `logical-css`: no physical directions (`margin-left`, `text-align: left`, `ml-4`, `text-left`, `left-0`), so RTL works;
 * - `specific-errors`: no generic user-facing error text ("Something went wrong") on its own;
 * - `type-discriminator`: discriminator fields are named `type`, never `kind`;
 * - `no-js-imports`: relative import paths carry no `.js` extension.
 */
export type CodeRuleName =
  | "logical-css"
  | "specific-errors"
  | "type-discriminator"
  | "no-js-imports";

/** Every code rule. */
export const CODE_RULES: readonly CodeRuleName[] = [
  "logical-css",
  "specific-errors",
  "type-discriminator",
  "no-js-imports",
];

/**
 * A part of the project a change may touch only when its task names it
 * (`- Touches: auth, migrations`). `public-api` has no globs: it is the
 * difference between the routes and `grimoire/approved/api.json`.
 * `dependencies` counts only added or changed dependency entries of a
 * `package.json`, not every edit of the file.
 */
export type ProtectedArea = {
  name: string;
  /** Project-relative globs (`**` crosses folders, `*` stays inside one). */
  globs: string[];
};

/** The built-in protected areas. A `protected` line in the settings with the same name replaces its globs. */
export const DEFAULT_PROTECTED_AREAS: readonly ProtectedArea[] = [
  { name: "migrations", globs: ["**/migrations/**", "**/*.migration.ts"] },
  { name: "auth", globs: ["src/app/auth/**", "src/config/auth.ts"] },
  { name: "config", globs: ["src/config/**", "warlock.config.ts", ".env.example"] },
  {
    name: "lockfile",
    globs: ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb"],
  },
  { name: "dependencies", globs: ["package.json", "**/package.json"] },
  { name: "public-api", globs: [] },
];

/** `grimoire/settings.md` as written (`WrittenGrimoire.settings`); `GrimoireSettings` is it with the defaults filled in. */
export type WrittenSettings = {
  file: string;
  languages: Located<string>[];
  screenshots: Located<ScreenshotMode> | null;
  /** `null` when the key is not written; `[]` when written empty. */
  rules: Located<CodeRuleName>[] | null;
  /** `- <name> <glob> [<glob>…]` lines of `protected`. */
  protected: { name: string; globs: string[]; at: SourceLocation }[];
};

/** The settings every reader uses: the written file with its defaults filled in. */
export type GrimoireSettings = {
  /** `grimoire/settings.md` when written, else `null`. */
  file: string | null;
  /** The app's languages, in order (`["en", "ar"]`); empty when the app names none. */
  languages: string[];
  /** Where `languages` came from: the settings file, the adapter's `languages()`, or nowhere. */
  languagesFrom: "settings" | "adapter" | "none";
  screenshots: ScreenshotMode;
  /**
   * The code rules written in `rules`, or `null` when the key is not written:
   * then `grimoire check` runs none and `grimoire guard` runs every rule on
   * the lines a change adds. `[]` turns them off everywhere.
   */
  rules: CodeRuleName[] | null;
  /** The built-in areas with the written lines applied. */
  protected: ProtectedArea[];
};

/** What a project without `grimoire/settings.md` (and an adapter with no languages) gets. */
export const DEFAULT_GRIMOIRE_SETTINGS: GrimoireSettings = {
  file: null,
  languages: [],
  languagesFrom: "none",
  screenshots: "changed",
  rules: null,
  protected: DEFAULT_PROTECTED_AREAS.map((area) => ({ name: area.name, globs: [...area.globs] })),
};

export type LintToolchain = "oxc";

/** The one structural fork that changes the generated app's shape. */
export type Stack = "api" | "web";

/** The UI kit choice: shadcn/Tailwind, Mantine, or neither. */
export type UiKit = "shadcn" | "mantine" | "none";

/**
 * What the "What are we building?" menu can return: a stack, `web-mantine` (the
 * web stack with the Mantine kit instead of shadcn, so the UI kit needs no
 * prompt of its own), or `customize` —
 * which is a FLOW, not a stack, and hands the run to the full wizard. It is
 * deliberately not a `--stack` value: `--stack=customize --yes` would have no
 * coherent meaning.
 */
export type SetupChoice = Stack | "web-mantine" | "customize";

export type AppOptions = {
  databaseDriver: string;
  databasePort: number;
  features: string[];
  aiProviders: string[];
  useGit: boolean;
  useJWT: boolean;
  /** Oxlint/Oxfmt, the only supported toolchain. */
  lint?: LintToolchain;
  /** `agent-kit` targets to derive per-agent docs/skills for. Default: `["claude"]`. */
  agents: string[];
};

export type App = {
  appName?: string;
  appType?: string;
  appPath?: string;
  options?: AppOptions;
  pkgManager?: string;
};

export type Application = Required<App>;

/**
 * Flags parsed from the command line for non-interactive scaffolding
 * (`create-warlock my-app --db=postgres --features=test,herald --ai=ai-openai --yes`).
 */
export type CliFlags = {
  yes?: boolean;
  name?: string;
  /** The one structural question the default path asks: API-only or full-stack web. */
  stack?: Stack;
  db?: string;
  features?: string[];
  /** `--ui=<shadcn|mantine|none>` — the design-system kit for web apps. */
  ui?: string;
  ai?: string[];
  pm?: string;
  /** `--lint=oxc`; validated before scaffolding. */
  lint?: string;
  /** `agent-kit` targets for `--agents`. Comma-separated on the CLI. */
  agents?: string[];
  git?: boolean;
  jwt?: boolean;
  /** `--interactive` / `--customize` — restore the full long-form prompt flow. */
  interactive?: boolean;
  /** `-h` / `--help` — print usage and exit before any scaffolding runs. */
  help?: boolean;
  /** `-v` / `--version` — print the installed version and exit. */
  version?: boolean;
};

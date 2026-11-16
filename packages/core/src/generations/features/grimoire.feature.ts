import { colors } from "@mongez/copper";
import { fileExistsAsync, getFileAsync, putFileAsync } from "../generation-fs";
import { rootPath, srcPath } from "../../utils";
import { insertCliCommandEntry } from "./shared/insert-cli-command-entry";
import {
  appendGitignoreLines,
  ensureImportLine,
  GRIMOIRE_DEVTOOLS_CONFIG,
  GRIMOIRE_GITIGNORE_LINES,
  insertDevtoolsPanel,
  insertVitestReporter,
} from "./shared/insert-grimoire-wiring";
import { type FeatureDefinition, INSTALLED_WARLOCK_VERSION } from "./types";

const COMMANDS_IMPORT = 'import { registerGrimoireCommands } from "@warlock.js/grimoire/warlock";';
const REPORTER_IMPORT = 'import { grimoireReporter } from "@warlock.js/grimoire/vitest";';

/** Register the `grimoire` and `scry` commands in the app-owned configuration. */
async function registerCommands(): Promise<void> {
  const configPath = rootPath("warlock.config.ts");
  const manual =
    `  import { registerGrimoireCommands } from "@warlock.js/grimoire/warlock";\n` +
    `  export default defineConfig({ cli: { commands: [registerGrimoireCommands()] } });`;

  if (!(await fileExistsAsync(configPath))) {
    console.log(`${colors.yellowBright("warlock.config.ts")} not found — add this yourself:\n${manual}`);

    return;
  }

  const current = await getFileAsync(configPath);
  const insertion = insertCliCommandEntry(current, "registerGrimoireCommands()");

  if (insertion.status === "already-present") {
    console.log(`${colors.yellowBright("registerGrimoireCommands")} already registered, skipping...`);

    return;
  }

  if (insertion.status === "unrecognised") {
    console.log(
      `${colors.yellowBright("warlock.config.ts")} has no recognisable defineConfig({...}) — add this yourself:\n${manual}`,
    );

    return;
  }

  await putFileAsync(configPath, ensureImportLine(insertion.next, COMMANDS_IMPORT));
  console.log(`${colors.green("✓")} Registered registerGrimoireCommands() in warlock.config.ts`);
}

/** Keep the generated part of `grimoire/` out of git. */
async function ignoreGeneratedFiles(): Promise<void> {
  const ignorePath = rootPath(".gitignore");
  const current = (await fileExistsAsync(ignorePath)) ? await getFileAsync(ignorePath) : "";
  const next = appendGitignoreLines(current, GRIMOIRE_GITIGNORE_LINES);

  if (next !== null) {
    await putFileAsync(ignorePath, next);
    console.log(`${colors.green("✓")} Added the generated Grimoire files to .gitignore`);
  }
}

/** Show the Grimoire tab in devtools (read only in development, only when devtools is installed). */
async function mountDevtoolsPanel(): Promise<void> {
  const configPath = srcPath("config/devtools.ts");

  if (!(await fileExistsAsync(configPath))) {
    await putFileAsync(configPath, GRIMOIRE_DEVTOOLS_CONFIG);
    console.log(`${colors.green("✓")} Created src/config/devtools.ts with the Grimoire panel`);

    return;
  }

  const insertion = insertDevtoolsPanel(await getFileAsync(configPath), "@warlock.js/grimoire/devtools");

  if (insertion.status === "added") {
    await putFileAsync(configPath, insertion.next);
    console.log(`${colors.green("✓")} Added the Grimoire panel to src/config/devtools.ts`);
  } else if (insertion.status === "unrecognised") {
    console.log(
      `${colors.yellowBright("src/config/devtools.ts")} has no recognisable settings object — ` +
        'add `panels: ["@warlock.js/grimoire/devtools"]` yourself.',
    );
  }
}

/**
 * Record test results for Grimoire when the app already runs Vitest. When the
 * app has no `vite.config.ts` yet, `warlock add test` adds the reporter itself.
 */
async function registerReporter(): Promise<void> {
  const configPath = rootPath("vite.config.ts");

  if (!(await fileExistsAsync(configPath))) {
    return;
  }

  const insertion = insertVitestReporter(await getFileAsync(configPath), "grimoireReporter()");

  if (insertion.status === "added") {
    await putFileAsync(configPath, ensureImportLine(insertion.next, REPORTER_IMPORT));
    console.log(`${colors.green("✓")} Added grimoireReporter() to vite.config.ts`);
  } else if (insertion.status === "unrecognised") {
    console.log(
      `${colors.yellowBright("vite.config.ts")} has no recognisable test block — add ` +
        '`reporters: ["default", grimoireReporter()]` (from "@warlock.js/grimoire/vitest") yourself.',
    );
  }
}

/** `warlock add grimoire` — the experimental project map for agents. */
export const grimoireFeature: FeatureDefinition = {
  description:
    "Installs @warlock.js/grimoire (experimental) — a project map for AI agents. Registers the grimoire and scry commands in warlock.config.ts, ignores the generated files in .gitignore, mounts the devtools tab and records test results when Vitest is configured.",
  dependencies: {
    "@warlock.js/grimoire": INSTALLED_WARLOCK_VERSION,
  },
  async onExecuting() {
    await registerCommands();
    await ignoreGeneratedFiles();
    await mountDevtoolsPanel();
    await registerReporter();
    console.log(
      `Grimoire is experimental. Next: run ${colors.cyan("warlock grimoire build")}, then ask your agent to use the use-the-grimoire skill.`,
    );
  },
};

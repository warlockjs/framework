import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CLICommand } from "../commands/cli-command";
import type { FilesOrchestrator as FilesOrchestratorType } from "./files-orchestrator";

/**
 * `warlock generate.typings` used to add only `src/config/**` files to the
 * orchestrator, so on an app whose keys came from a web register module it
 * wrote an EMPTY `TranslationKeyRegistry {}` — while `warlock dev`, which
 * discovers the whole project at boot, produced the real registry from the
 * same checkout. Both paths call the same `typeGenerator.generateAll()`; this
 * proves the CLI command now discovers the same sources first, so a fresh
 * checkout gets the identical registry regardless of which one generated it.
 *
 * Imports are dynamic, after `process.chdir` — see `type-generator.spec.ts`
 * for why: the manifest path and typings output dir are resolved from
 * `process.cwd()` once, at first import, and a static import here would bake
 * them to this test file's real cwd instead of the fixture's temp dir.
 */
describe("generate.typings CLI matches dev's discovery (aebdc498)", () => {
  let tempRoot: string;
  let previousCwd: string;
  let filesOrchestrator: FilesOrchestratorType;
  let typeGenerator: (typeof import("./type-generator"))["typeGenerator"];
  let typingsGeneratorCommand: CLICommand;

  beforeAll(async () => {
    previousCwd = process.cwd();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "warlock-generate-typings-"));
    process.chdir(tempRoot);

    ({ filesOrchestrator } = await import("./files-orchestrator"));
    ({ typeGenerator } = await import("./type-generator"));
    ({ typingsGeneratorCommand } = await import("../cli/commands/typings-generator.command"));
  }, 120_000); // heavy post-chdir module transforms; >30s under full-suite load

  afterAll(async () => {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    filesOrchestrator.files.clear();
    await fs.rm(path.join(tempRoot, ".warlock"), { recursive: true, force: true });
    await fs.rm(path.join(tempRoot, "src"), { recursive: true, force: true });

    await fs.mkdir(path.join(tempRoot, "src/web"), { recursive: true });

    await fs.writeFile(
      path.join(tempRoot, "src/web/layout.register.ts"),
      `
        import { groupedTranslations } from "@warlock.js/core";

        export function register() {
          groupedTranslations("layout", { footer: { en: "Footer" } });
        }
      `,
    );
  });

  afterEach(async () => {
    await fs.rm(path.join(tempRoot, ".warlock"), { recursive: true, force: true });
    await fs.rm(path.join(tempRoot, "src"), { recursive: true, force: true });
  });

  it("discovers a web register module outside src/config and writes its key", async () => {
    await typingsGeneratorCommand.execute({ args: [], options: {} });

    const content = await fs.readFile(
      path.join(tempRoot, ".warlock/typings/translations.d.ts"),
      "utf-8",
    );

    expect(content).toContain('"layout.footer": true;');
  });

  it("produces byte-identical output to the dev code path (both call the same generateAll)", async () => {
    await typingsGeneratorCommand.execute({ args: [], options: {} });
    const viaCli = await fs.readFile(
      path.join(tempRoot, ".warlock/typings/translations.d.ts"),
      "utf-8",
    );

    await fs.rm(path.join(tempRoot, ".warlock"), { recursive: true, force: true });
    filesOrchestrator.files.clear();

    await filesOrchestrator.initializeAll();
    await typeGenerator.generateAll();
    const viaDev = await fs.readFile(
      path.join(tempRoot, ".warlock/typings/translations.d.ts"),
      "utf-8",
    );

    expect(viaCli).toEqual(viaDev);
  });
});

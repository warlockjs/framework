import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilesOrchestrator as FilesOrchestratorType } from "./files-orchestrator";
import type { TypeGenerator as TypeGeneratorType } from "./type-generator";

/**
 * `TypeGenerator.generateTranslationTypes` used to scan only files matching
 * `isLocalesFile` (path contains `/utils/locales.`). A web module registering
 * keys anywhere else in `src/` — e.g. `src/web/*.register.ts` — was invisible
 * to the generator, so a fresh checkout produced an empty or partial
 * `TranslationKeyRegistry` even though `groupedTranslations` calls existed.
 *
 * This fixture proves discovery now covers the whole app source tree: a
 * dedicated locales file, a named-group-form register module, and an
 * object-form register module (the scaffold's own shape), including nested
 * groups and a dynamic key that must be skipped.
 *
 * `filesOrchestrator`/`type-generator` resolve `.warlock/manifest.json` and
 * the typings output directory from `process.cwd()` ONCE — a module-level
 * constant and a class-field initializer, evaluated the first time these
 * modules are imported. A static top-level `import` here would bake those
 * paths to this test file's real cwd (`core/`) instead of the fixture's temp
 * dir, writing test output into the actual package. So the modules are
 * imported dynamically, after `process.chdir`, once per suite.
 */
describe("TypeGenerator — translation key discovery over all app source", () => {
  let tempRoot: string;
  let previousCwd: string;
  let filesOrchestrator: FilesOrchestratorType;
  let TypeGenerator: typeof TypeGeneratorType;
  let listRouteLocaleKeysForTypeGeneration: typeof import("./type-generator").listRouteLocaleKeysForTypeGeneration;

  beforeAll(async () => {
    previousCwd = process.cwd();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "warlock-type-generator-"));
    process.chdir(tempRoot);

    ({ filesOrchestrator } = await import("./files-orchestrator"));
    ({ TypeGenerator, listRouteLocaleKeysForTypeGeneration } = await import("./type-generator"));
  }, 120_000); // heavy post-chdir module transforms; >30s under full-suite load

  afterAll(async () => {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    filesOrchestrator.files.clear();
    await fs.rm(path.join(tempRoot, ".warlock"), { recursive: true, force: true });
    await fs.rm(path.join(tempRoot, "src"), { recursive: true, force: true });

    await fs.mkdir(path.join(tempRoot, "src/utils"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "src/web/home"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, "node_modules/@warlock.js/web"), { recursive: true });

    await fs.writeFile(
      path.join(tempRoot, "node_modules/@warlock.js/web/package.json"),
      JSON.stringify({
        name: "@warlock.js/web",
        type: "module",
        exports: { ".": "./index.mjs", "./build": "./build.mjs" },
      }),
      "utf-8",
    );
    await fs.writeFile(
      path.join(tempRoot, "node_modules/@warlock.js/web/index.mjs"),
      "export {};",
      "utf-8",
    );
    await fs.writeFile(
      path.join(tempRoot, "node_modules/@warlock.js/web/build.mjs"),
      'export function listRouteLocaleKeys() { return ["json.home.title", "json.shared.save"]; }',
      "utf-8",
    );

    await fs.writeFile(
      path.join(tempRoot, "src/utils/locales.ts"),
      `
        import { groupedTranslations } from "@mongez/localization";

        groupedTranslations("products", {
          notFound: { en: "Not found" },
          detail: {
            title: { en: "Title", ar: "العنوان" },
          },
        });
      `,
    );

    await fs.writeFile(
      path.join(tempRoot, "src/web/layout.register.ts"),
      `
        import { groupedTranslations } from "@warlock.js/core";

        export function register() {
          groupedTranslations("layout", {
            [dynamicKey]: { en: "Skipped" },
            footer: { en: "Footer" },
          });
        }
      `,
    );

    await fs.writeFile(
      path.join(tempRoot, "src/web/home/register.ts"),
      `
        import { groupedTranslations } from "@mongez/localization";

        export function register() {
          groupedTranslations({
            site: {
              home: { en: "Home", ar: "الرئيسية" },
            },
          });
        }
      `,
    );
  });

  afterEach(async () => {
    await fs.rm(path.join(tempRoot, ".warlock"), { recursive: true, force: true });
    await fs.rm(path.join(tempRoot, "src"), { recursive: true, force: true });
  });

  it("collects leaf keys from locale files and both register-module forms, skipping dynamic keys", async () => {
    await filesOrchestrator.initializeAll();

    const generator = new TypeGenerator();
    await generator.generateAll();

    const content = await fs.readFile(
      path.join(tempRoot, ".warlock/typings/translations.d.ts"),
      "utf-8",
    );

    expect(content).toContain('"products.notFound": true;');
    expect(content).toContain('"products.detail.title": true;');
    expect(content).toContain('"layout.footer": true;');
    expect(content).toContain('"site.home": true;');
    expect(content).toContain('"json.home.title": true;');
    expect(content).toContain('"json.shared.save": true;');
    expect(content).not.toContain("dynamicKey");
  });

  it("drops keys after their registering file is deleted, on the next generation", async () => {
    await filesOrchestrator.initializeAll();

    const generator = new TypeGenerator();
    await generator.generateAll();

    await fs.rm(path.join(tempRoot, "src/web/home/register.ts"));
    filesOrchestrator.files.delete("src/web/home/register.ts");

    await generator.generateAll();

    const content = await fs.readFile(
      path.join(tempRoot, ".warlock/typings/translations.d.ts"),
      "utf-8",
    );

    expect(content).not.toContain("site.home");
    expect(content).toContain('"products.notFound": true;');
  });

  it("recognizes route locale JSON changes and deletions without treating other JSON as a key source", () => {
    const generator = new TypeGenerator();

    expect(generator.shouldRegenerateTypes("src/web/locales.json")).toBe(true);
    expect(generator.shouldRegenerateTypes("src\\web\\account\\locales.json")).toBe(true);
    expect(
      generator.shouldRegenerateTypes(path.join(tempRoot, "src/web/account/locales.json")),
    ).toBe(true);
    expect(generator.shouldRegenerateTypes("src/web/account/locales.json")).toBe(true);
    expect(generator.shouldRegenerateTypes("src/app/locales.json")).toBe(false);
    expect(generator.shouldRegenerateTypes("src/web/locale.json")).toBe(false);
  });

  it("resolves the web build from the requested project and returns an empty union when web is absent", async () => {
    const projectRoot = path.join(tempRoot, "project-local-web");
    const packageRoot = path.join(projectRoot, "node_modules/@warlock.js/web");
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@warlock.js/web",
        type: "module",
        exports: { ".": "./index.mjs", "./build": "./build.mjs" },
      }),
      "utf-8",
    );
    await fs.writeFile(path.join(packageRoot, "index.mjs"), "export {};", "utf-8");
    await fs.writeFile(
      path.join(packageRoot, "build.mjs"),
      'export function listRouteLocaleKeys() { return ["project.local.only"]; }',
      "utf-8",
    );

    expect(await listRouteLocaleKeysForTypeGeneration(projectRoot)).toEqual(["project.local.only"]);

    const noWebProject = await fs.mkdtemp(path.join(os.tmpdir(), "warlock-no-web-"));
    try {
      expect(await listRouteLocaleKeysForTypeGeneration(noWebProject)).toEqual([]);
    } finally {
      await fs.rm(noWebProject, { recursive: true, force: true });
    }
  });

  it("surfaces installed web build resolution and export failures", async () => {
    const missingBuildProject = path.join(tempRoot, "missing-web-build");
    const missingBuildPackage = path.join(missingBuildProject, "node_modules/@warlock.js/web");
    await fs.mkdir(missingBuildPackage, { recursive: true });
    await fs.writeFile(
      path.join(missingBuildPackage, "package.json"),
      JSON.stringify({ name: "@warlock.js/web", type: "module", exports: { ".": "./index.mjs" } }),
      "utf-8",
    );
    await fs.writeFile(path.join(missingBuildPackage, "index.mjs"), "export {};", "utf-8");
    await expect(listRouteLocaleKeysForTypeGeneration(missingBuildProject)).rejects.toThrow();

    const missingExportProject = path.join(tempRoot, "missing-web-export");
    const missingExportPackage = path.join(missingExportProject, "node_modules/@warlock.js/web");
    await fs.mkdir(missingExportPackage, { recursive: true });
    await fs.writeFile(
      path.join(missingExportPackage, "package.json"),
      JSON.stringify({
        name: "@warlock.js/web",
        type: "module",
        exports: { ".": "./index.mjs", "./build": "./build.mjs" },
      }),
      "utf-8",
    );
    await fs.writeFile(path.join(missingExportPackage, "index.mjs"), "export {};", "utf-8");
    await fs.writeFile(path.join(missingExportPackage, "build.mjs"), "export {};", "utf-8");
    await expect(listRouteLocaleKeysForTypeGeneration(missingExportProject)).rejects.toThrow(
      /does not export listRouteLocaleKeys/u,
    );
  });

  it("regenerates for route locale JSON add, edit, and delete batches and direct lifecycle calls", async () => {
    const generator = new TypeGenerator();
    const generateAll = vi.spyOn(generator, "generateAll").mockResolvedValue();
    const generateTranslations = vi
      .spyOn(
        generator as unknown as { generateTranslationTypes(): Promise<void> },
        "generateTranslationTypes",
      )
      .mockResolvedValue();

    await generator.executeTypingsGenerator(["src/web/locales.json"]);
    await generator.executeTypingsGenerator(["src/web/account/locales.json"]);
    await generator.executeTypingsGenerator(["src/web/removed/locales.json"]);
    expect(generateAll).toHaveBeenCalledTimes(3);

    await generator.handleFileChange("src/web/locales.json");
    await generator.handleFileChange("src/web/account/locales.json");
    await generator.handleFileChange("src/web/removed/locales.json");
    expect(generateTranslations).toHaveBeenCalledTimes(3);
  });
});

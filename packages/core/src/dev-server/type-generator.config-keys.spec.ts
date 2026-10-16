import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FilesOrchestrator as FilesOrchestratorType } from "./files-orchestrator";
import type {
  TypeGenerator as TypeGeneratorType,
  readPropertyName as readPropertyNameType,
} from "./type-generator";

/**
 * FW-06: config keys were read with `getText()`, which keeps a string-literal
 * key's quotes, so `"machine-thumb"` under `images.variants` was written as
 * `"uploads.images.variants."machine-thumb"": true;` and broke the generated
 * `config.d.ts`. A single-quoted key produced a wrong key instead.
 *
 * Same chdir-before-import setup as `type-generator.spec.ts`: the generator
 * resolves its output directory from `process.cwd()` once, at import.
 */
describe("TypeGenerator — quoted config keys (FW-06)", () => {
  let tempRoot: string;
  let previousCwd: string;
  let filesOrchestrator: FilesOrchestratorType;
  let TypeGenerator: typeof TypeGeneratorType;
  let readPropertyName: typeof readPropertyNameType;
  let TYPINGS_MANIFEST_VERSION: string;

  beforeAll(async () => {
    previousCwd = process.cwd();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "warlock-config-keys-"));
    process.chdir(tempRoot);

    ({ filesOrchestrator } = await import("./files-orchestrator"));
    ({ TypeGenerator, readPropertyName, TYPINGS_MANIFEST_VERSION } =
      await import("./type-generator"));
  }, 120_000);

  afterAll(async () => {
    process.chdir(previousCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    filesOrchestrator.files.clear();
    await fs.mkdir(path.join(tempRoot, "src/config"), { recursive: true });

    await fs.writeFile(
      path.join(tempRoot, "src/config/uploads.ts"),
      `
        const uploadsConfigurations = {
          images: {
            variants: {
              "machine-thumb": { width: 480 },
              'single-quoted': { width: 240 },
              plain: { width: 120 },
              404: { width: 1 },
              [computedKey]: { width: 2 },
            },
          },
        };

        export default uploadsConfigurations;
      `,
    );

    await fs.writeFile(
      path.join(tempRoot, "src/config/storage.ts"),
      `
        const storageConfigurations = {
          default: "local",
          drivers: {
            local: { root: "storage" },
            "do-spaces": { bucket: "assets" },
          },
        };

        export default storageConfigurations;
      `,
    );
  });

  afterEach(async () => {
    await fs.rm(path.join(tempRoot, ".warlock"), { recursive: true, force: true });
    await fs.rm(path.join(tempRoot, "src"), { recursive: true, force: true });
  });

  async function generate() {
    await filesOrchestrator.initializeAll();
    await new TypeGenerator().generateAll();
  }

  function syntaxErrors(source: string) {
    // Parsed as a `.ts` module: transpileModule cannot emit a `.d.ts` name,
    // and the declarations here are just as valid in a module file.
    const output = ts.transpileModule(source, {
      reportDiagnostics: true,
      fileName: "generated-typings.ts",
    });

    return (output.diagnostics ?? []).map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    );
  }

  it("writes quoted keys without their quotes, as valid TypeScript", async () => {
    await generate();

    const content = await fs.readFile(path.join(tempRoot, ".warlock/typings/config.d.ts"), "utf-8");

    expect(content).toContain('"uploads.images.variants.machine-thumb": true;');
    expect(content).toContain('"uploads.images.variants.single-quoted": true;');
    expect(content).toContain('"uploads.images.variants.plain": true;');
    expect(content).toContain('"uploads.images.variants.404": true;');
    expect(content).not.toContain('."machine-thumb"');
    expect(content).not.toContain("'single-quoted'");
    expect(syntaxErrors(content)).toEqual([]);
  });

  it("skips computed keys, which have no static name", async () => {
    await generate();

    const content = await fs.readFile(path.join(tempRoot, ".warlock/typings/config.d.ts"), "utf-8");

    expect(content).not.toContain("computedKey");
  });

  it("writes a quoted storage driver name once quoted, not twice", async () => {
    await generate();

    const typingsDir = path.join(tempRoot, ".warlock/typings");
    // Only the generated declarations; `typings-manifest.json` is not TypeScript.
    const files = (await fs.readdir(typingsDir)).filter((file) => file.endsWith(".d.ts"));
    const contents = await Promise.all(
      files.map((file) => fs.readFile(path.join(typingsDir, file), "utf-8")),
    );
    const all = contents.join("\n");

    expect(all).toContain('"do-spaces"');
    expect(all).not.toContain('\\"do-spaces\\"');

    files.forEach((file, index) => {
      expect({ file, errors: syntaxErrors(contents[index]!) }).toEqual({ file, errors: [] });
    });
  });

  it("regenerates a broken config.d.ts left by an older generator, even when no config changed", async () => {
    await generate();

    const typingsDir = path.join(tempRoot, ".warlock/typings");
    const manifestPath = path.join(typingsDir, "typings-manifest.json");
    const configPath = path.join(typingsDir, "config.d.ts");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));

    // What a 5.29 project carries into the upgrade: same source hashes, the
    // old manifest version, keys cached with their quotes and the invalid file.
    manifest.version = "1.0.0";
    for (const entry of Object.values(manifest.config) as Array<{ keys: string[] }>) {
      entry.keys = entry.keys.map((key) => key.replace("machine-thumb", '"machine-thumb"'));
    }
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    await fs.writeFile(
      configPath,
      'declare module "@mongez/config" {\n  interface ConfigKeys {\n    "uploads.images.variants."machine-thumb"": true;\n  }\n}\n',
    );

    await new TypeGenerator().generateAll();

    const content = await fs.readFile(configPath, "utf-8");
    const saved = JSON.parse(await fs.readFile(manifestPath, "utf-8"));

    expect(content).toContain('"uploads.images.variants.machine-thumb": true;');
    expect(content).not.toContain('."machine-thumb"');
    expect(syntaxErrors(content)).toEqual([]);
    expect(saved.version).toBe(TYPINGS_MANIFEST_VERSION);
  });

  describe("readPropertyName", () => {
    function nameOf(source: string) {
      const file = ts.createSourceFile(
        "x.ts",
        `const x = { ${source}: 1 };`,
        ts.ScriptTarget.Latest,
      );
      const statement = file.statements[0] as ts.VariableStatement;
      const literal = statement.declarationList.declarations[0]!
        .initializer as ts.ObjectLiteralExpression;

      return readPropertyName((literal.properties[0] as ts.PropertyAssignment).name);
    }

    it("reads identifiers, string, numeric and template keys without quotes", () => {
      expect(nameOf("plain")).toBe("plain");
      expect(nameOf('"machine-thumb"')).toBe("machine-thumb");
      expect(nameOf("'single-quoted'")).toBe("single-quoted");
      expect(nameOf("404")).toBe("404");
    });

    it("returns undefined for a computed key", () => {
      expect(nameOf("[KEY]")).toBeUndefined();
    });
  });
});

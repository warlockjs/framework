import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isUnknownTsExtensionError,
  isUnresolvedConfigImportError,
} from "../../../src/warlock-config/warlock-config.manager";

const run = promisify(execFile);

/**
 * WR-004: the config fallback must load a `warlock.config.ts` whose LOCAL graph
 * uses what only TypeScript resolves — an extensionless import and a tsconfig
 * `paths` alias — while packages stay external (one `BaseConnector` identity),
 * the config runs once, user errors survive and no temp module is left behind.
 *
 * Each case runs in a disposable Node child so module caches, native type
 * stripping and the real loader errors are those of a fresh process.
 */

const repositoryRoot = resolve(__dirname, "../../../../..");
const managerPath = resolve(__dirname, "../../../src/warlock-config/warlock-config.manager.ts");
const tsxLoader = pathToFileURL(
  createRequire(join(repositoryRoot, "package.json")).resolve("tsx/esm"),
).href;

let root: string;

function write(relativePath: string, contents: string) {
  const filePath = join(root, relativePath);

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function writeFixture(configBody: string) {
  write(
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "app/*": ["src/app/*"] } } }),
  );
  write(
    "node_modules/fake-warlock/package.json",
    JSON.stringify({ name: "fake-warlock", type: "module", main: "index.js" }),
  );
  write(
    "node_modules/fake-warlock/index.js",
    "globalThis.__fakeWarlockLoads = (globalThis.__fakeWarlockLoads ?? 0) + 1;\n" +
      "export class BaseConnector {}\n",
  );
  write("src/app/labels.ts", 'export const label: string = "aliased";\n');
  write(
    "src/connectors/local.ts",
    'import { BaseConnector } from "fake-warlock";\n' +
      'import { label } from "app/labels";\n' +
      "export class LocalConnector extends BaseConnector {\n" +
      "  public readonly label: string = label;\n" +
      "}\n" +
      'export const assetUrl = new URL("./asset.txt", import.meta.url).href;\n',
  );
  write("warlock.config.ts", configBody);
}

/**
 * Load the config through the manager's fallback in a child process. `tsx`
 * only lets the child import the manager's TypeScript source; the config
 * itself goes through `loadViaEsbuild` and a plain `.mjs` import.
 */
async function loadInChild() {
  write(
    "driver.mjs",
    `import { BaseConnector } from "fake-warlock";
import { WarlockConfigManager } from ${JSON.stringify(pathToFileURL(managerPath).href)};
const manager = new WarlockConfigManager();
const report = {};
try {
  const config = await manager["loadViaEsbuild"](${JSON.stringify(join(root, "warlock.config.ts"))});
  report.label = config.connectors[0].label;
  report.sameBaseConnector = config.connectors[0] instanceof BaseConnector;
  report.assetUrl = config.assetUrl;
} catch (error) {
  report.error = { name: error.name, message: error.message };
}
report.configRuns = globalThis.__configRuns ?? 0;
report.packageLoads = globalThis.__fakeWarlockLoads ?? 0;
console.log(JSON.stringify(report));
`,
  );

  const { stdout } = await run(process.execPath, ["--import", tsxLoader, "driver.mjs"], {
    cwd: root,
    timeout: 60_000,
  });

  return JSON.parse(stdout.trim().split("\n").pop() as string);
}

const leftovers = () =>
  readdirSync(root).filter((name) => name.endsWith(".mjs") && name !== "driver.mjs");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "warlock-config-graph-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("warlock.config.ts with a local TypeScript import graph", () => {
  it("falls back on the error this Node raises for the native import", async () => {
    writeFixture(
      'import { LocalConnector } from "./src/connectors/local";\n' +
        "export default { connectors: [new LocalConnector()] };\n",
    );

    // Node < 22.18 refuses `.ts` (ERR_UNKNOWN_FILE_EXTENSION); native type
    // stripping refuses the extensionless import (ERR_MODULE_NOT_FOUND).
    // Either way the manager must take the bundled path.
    const probe = `import(${JSON.stringify(pathToFileURL(join(root, "warlock.config.ts")).href)})
      .then(() => console.log(JSON.stringify({ loaded: true })))
      .catch((error) => console.log(JSON.stringify({ code: error.code, message: error.message })));`;
    const { stdout } = await run(process.execPath, ["--input-type=module", "-e", probe], {
      cwd: root,
      timeout: 30_000,
    });
    const outcome = JSON.parse(stdout.trim());

    expect(outcome.loaded).toBeUndefined();
    expect(isUnknownTsExtensionError(outcome) || isUnresolvedConfigImportError(outcome)).toBe(true);
  });

  it("loads extensionless and aliased imports, keeps packages external and runs once", async () => {
    writeFixture(
      'import { LocalConnector, assetUrl } from "./src/connectors/local";\n' +
        "globalThis.__configRuns = (globalThis.__configRuns ?? 0) + 1;\n" +
        "export default { connectors: [new LocalConnector()], assetUrl };\n",
    );

    const report = await loadInChild();

    expect(report.error).toBeUndefined();
    expect(report.label).toBe("aliased");
    expect(report.sameBaseConnector).toBe(true);
    expect(report.packageLoads).toBe(1);
    expect(report.configRuns).toBe(1);
    // `import.meta.url` in an inlined module still names its original file.
    expect(report.assetUrl).toBe(pathToFileURL(join(root, "src/connectors/asset.txt")).href);
    expect(leftovers()).toEqual([]);
  });

  it("propagates the user's own error and still removes the temp module", async () => {
    writeFixture(
      'import { LocalConnector } from "./src/connectors/local";\n' +
        "class ConfigBoom extends Error { name = 'ConfigBoom'; }\n" +
        "globalThis.__configRuns = (globalThis.__configRuns ?? 0) + 1;\n" +
        'throw new ConfigBoom("missing DATABASE_URL");\n' +
        "export default { connectors: [new LocalConnector()] };\n",
    );

    const report = await loadInChild();

    expect(report.error).toEqual({ name: "ConfigBoom", message: "missing DATABASE_URL" });
    expect(report.configRuns).toBe(1);
    expect(leftovers()).toEqual([]);
  });
});

describe("isUnresolvedConfigImportError", () => {
  it("matches unresolved module and directory imports", () => {
    expect(isUnresolvedConfigImportError({ code: "ERR_MODULE_NOT_FOUND" })).toBe(true);
    expect(isUnresolvedConfigImportError({ code: "ERR_UNSUPPORTED_DIR_IMPORT" })).toBe(true);
  });

  it("ignores errors thrown by the config itself", () => {
    expect(isUnresolvedConfigImportError(new Error("missing DATABASE_URL"))).toBe(false);
    expect(isUnresolvedConfigImportError(undefined)).toBe(false);
  });
});

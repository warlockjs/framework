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
  isUnsupportedTypeStrippingError,
} from "../../../src/warlock-config/warlock-config.manager";

const run = promisify(execFile);

/**
 * the config fallback must load a `warlock.config.ts` whose LOCAL graph
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

function writeFixture(
  configBody: string,
  paths: Record<string, string[]> = { "app/*": ["src/app/*"] },
) {
  write("tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: ".", paths } }));
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

  it("keeps packages external under a catch-all `*` paths pattern", async () => {
    writeFixture(
      'import { LocalConnector } from "./src/connectors/local";\n' +
        "export default { connectors: [new LocalConnector()] };\n",
      { "*": ["./types/*"], "app/*": ["src/app/*"] },
    );

    const report = await loadInChild();

    expect(report.error).toBeUndefined();
    expect(report.label).toBe("aliased");
    expect(report.sameBaseConnector).toBe(true);
    expect(report.packageLoads).toBe(1);
  });

  it("leaves import.meta text inside strings and comments alone", async () => {
    writeFixture(
      'import { LocalConnector } from "./src/connectors/local";\n' +
        'import { note, single, template } from "./src/notes";\n' +
        "export default { connectors: [new LocalConnector()], assetUrl: note + '|' + single + '|' + template };\n",
    );
    write(
      "src/notes.ts",
      "// import.meta.url in a comment\n" +
        'export const note: string = "uses import.meta.url here";\n' +
        "export const single: string = 'and import.meta.dirname';\n" +
        "export const template: string = `and import.meta.filename`;\n",
    );

    const report = await loadInChild();

    expect(report.error).toBeUndefined();
    expect(report.assetUrl).toBe(
      "uses import.meta.url here|and import.meta.dirname|and import.meta.filename",
    );
  });

  it("names warlock.config.ts, not the temp module, when the bundled config cannot load", async () => {
    writeFixture(
      'import "not-installed-package";\n' +
        'import { LocalConnector } from "./src/connectors/local";\n' +
        "export default { connectors: [new LocalConnector()] };\n",
    );

    const report = await loadInChild();

    expect(report.error?.message).toContain("warlock.config.ts");
    expect(report.error?.message).toContain("not-installed-package");
    expect(report.error?.message).not.toMatch(/\.warlock\.config\.\d+\.\d+\.mjs/);
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
  const notFound = (message: string) => ({ code: "ERR_MODULE_NOT_FOUND", message });

  it("matches unresolved module and directory imports", () => {
    expect(isUnresolvedConfigImportError({ code: "ERR_MODULE_NOT_FOUND" })).toBe(true);
    expect(isUnresolvedConfigImportError({ code: "ERR_UNSUPPORTED_DIR_IMPORT" })).toBe(true);
    expect(
      isUnresolvedConfigImportError(
        notFound(
          "Cannot find module '/app/src/connectors/local' imported from /app/warlock.config.ts",
        ),
      ),
    ).toBe(true);
  });

  it("matches a bare specifier only when it is a tsconfig alias", () => {
    const aliased = notFound("Cannot find package 'app' imported from /app/warlock.config.ts");

    expect(isUnresolvedConfigImportError(aliased, ["app/*"])).toBe(true);
    expect(isUnresolvedConfigImportError(aliased, [])).toBe(false);
    expect(
      isUnresolvedConfigImportError(
        notFound("Cannot find package '@shared/utils' imported from /app/warlock.config.ts"),
        ["@shared/*"],
      ),
    ).toBe(true);
  });

  it("does not fall back for a package that is not installed", () => {
    expect(
      isUnresolvedConfigImportError(
        notFound("Cannot find package 'redis' imported from /app/warlock.config.ts"),
        ["app/*"],
      ),
    ).toBe(false);
  });

  it("does not fall back for a module missing inside node_modules", () => {
    expect(
      isUnresolvedConfigImportError(
        notFound(
          "Cannot find module '/app/node_modules/pkg/dist/x.js' imported from /app/node_modules/pkg/dist/index.js",
        ),
      ),
    ).toBe(false);
  });

  it("ignores errors thrown by the config itself", () => {
    expect(isUnresolvedConfigImportError(new Error("missing DATABASE_URL"))).toBe(false);
    expect(isUnresolvedConfigImportError(undefined)).toBe(false);
  });
});

describe("isUnsupportedTypeStrippingError", () => {
  it("matches the type-stripping refusals that happen before the graph runs", () => {
    expect(isUnsupportedTypeStrippingError({ code: "ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX" })).toBe(
      true,
    );
    expect(
      isUnsupportedTypeStrippingError({ code: "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING" }),
    ).toBe(true);
    expect(isUnsupportedTypeStrippingError(new Error("boom"))).toBe(false);
  });
});

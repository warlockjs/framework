import { v } from "@warlock.js/seal";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createEndpointGenerator } from "../../../src/cli/commands/generate/generators/endpoint.generator";
import { setDryRun } from "../../../src/cli/commands/generate/utils/writer";

/**
 * `warlock make endpoint` output, compiled for real.
 *
 * The generator runs into a temp directory exactly as the CLI would, and every
 * file it wrote is then compiled — in one `ts.createProgram` call, against the
 * real `@warlock.js/*` sources (`tsconfig.typecheck.json` paths) — next to the
 * two app files generated code imports from the starter: the guarded request
 * type and the `guarded()` router helper, read from the create-warlock template
 * itself so this cannot drift from what a new app ships.
 *
 * A guarded and a public endpoint, with a schema copied from a spec file, cover
 * both controller shapes, both route shapes and both test shapes. A broken
 * snippet (a typo'd response key in `responseSchema`) proves the program
 * actually type-checks rather than resolving everything to `any`.
 *
 * Same cost note as `generated-notifications-stub-types.test.ts`: building
 * core's graph takes tens of seconds, so it is paid once.
 */

const CORE_DIR = path.resolve(__dirname, "../../..").split(path.sep).join("/");
const TEMPLATE_APP = path.resolve(CORE_DIR, "../create-warlock/templates/warlock/src/app");
const VIRTUAL_ROOT = `${CORE_DIR}/__generated-endpoint-types-test__`;

const virtualFiles: Record<string, string> = {};

function loadCompilerOptions(): ts.CompilerOptions {
  const configPath = path.join(CORE_DIR, "tsconfig.typecheck.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);

  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, CORE_DIR);

  return {
    ...parsed.options,
    paths: {
      ...parsed.options.paths,
      "@warlock.js/core/tests": ["./src/tests/index.ts"],
      "app/*": ["./__generated-endpoint-types-test__/src/app/*"],
    },
  };
}

function compile(files: Record<string, string>): Record<string, string[]> {
  const options = loadCompilerOptions();
  const host = ts.createCompilerHost(options, true);
  const virtualPaths = new Set(Object.keys(files));
  const virtualDirectories = new Set(
    [...virtualPaths].flatMap((file) => {
      const parts = file.split("/");

      return parts.slice(1, -1).map((_, index) => parts.slice(0, index + 2).join("/"));
    }),
  );

  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => virtualPaths.has(fileName) || fileExists(fileName);

  const directoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (directory) =>
    virtualDirectories.has(directory.replace(/\/$/, "")) ||
    (directoryExists ? directoryExists(directory) : true);

  const readFileFromHost = host.readFile.bind(host);
  host.readFile = (fileName) => files[fileName] ?? readFileFromHost(fileName);

  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const content = files[fileName];

    if (content !== undefined) {
      return ts.createSourceFile(fileName, content, languageVersion, true, ts.ScriptKind.TS);
    }

    return getSourceFile(fileName, languageVersion, onError, shouldCreate);
  };

  const program = ts.createProgram({ rootNames: [...virtualPaths], options, host });
  const byFile: Record<string, string[]> = {};

  for (const file of virtualPaths) byFile[file] = [];

  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const fileName = diagnostic.file?.fileName;

    if (fileName && virtualPaths.has(fileName)) {
      byFile[fileName]?.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    }
  }

  return byFile;
}

async function collect(directory: string, base: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await collect(absolute, base);
    } else if (entry.name.endsWith(".ts")) {
      const relative = path.relative(base, absolute).split(path.sep).join("/");

      virtualFiles[`${VIRTUAL_ROOT}/${relative}`] = await readFile(absolute, "utf8");
    }
  }
}

let tempDir: string;
const originalCwd = process.cwd();

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "warlock-endpoint-types-"));
  process.chdir(tempDir);
  vi.spyOn(console, "log").mockImplementation(() => undefined);

  const { writeFile } = await import("node:fs/promises");

  await writeFile(
    path.join(tempDir, "post.spec.ts"),
    `import { v } from "@warlock.js/seal";

export const postInput = v.object({
  title: v.string().min(3),
  views: v.int().min(1).optional(),
  tags: v.array(v.string()),
});
`,
  );

  const generate = createEndpointGenerator(async () => ({
    postInput: v.object({
      title: v.string().min(3),
      views: v.int().min(1).optional(),
      tags: v.array(v.string()),
    }),
  }));

  await generate({ args: ["posts/create-post"], options: { schema: "./post.spec.ts" } });
  await generate({ args: ["posts/update-post"], options: { method: "patch", public: true } });
  await generate({ args: ["reports/list-reports"], options: { method: "get", public: true } });
  await generate({ args: ["reports/archive-report"], options: { method: "delete" } });

  await collect(path.join(tempDir, "src"), tempDir);

  // The starter files generated code imports, straight from the template.
  virtualFiles[`${VIRTUAL_ROOT}/src/app/auth/requests/guarded.request.ts`] = readFileSync(
    path.join(TEMPLATE_APP, "auth/requests/guarded.request.ts"),
    "utf8",
  );
  virtualFiles[`${VIRTUAL_ROOT}/src/app/shared/utils/router.ts`] = readFileSync(
    path.join(TEMPLATE_APP, "shared/utils/router.ts"),
    "utf8",
  );
  // Only the user's id matters to the guarded request type.
  virtualFiles[`${VIRTUAL_ROOT}/src/app/users/models/user.ts`] =
    "export type User = { id: number | string };\n";
});

afterAll(async () => {
  setDryRun(false);
  vi.restoreAllMocks();
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("make endpoint output type-checks against the real framework sources", () => {
  it("compiles every generated file, and rejects a broken response schema", () => {
    const broken = `${VIRTUAL_ROOT}/src/app/posts/controllers/broken.controller.ts`;
    const generated = Object.keys(virtualFiles).filter(
      (file) => !file.includes("/auth/") && !file.includes("/shared/") && !file.includes("/users/"),
    );

    expect(generated.length).toBeGreaterThanOrEqual(20);

    const results = compile({
      ...virtualFiles,
      [broken]: `import { type RequestHandler } from "@warlock.js/core";

export const brokenController: RequestHandler = async ({ response }) => response.success({});

brokenController.responseSchema = { 201: { body: { post: "not-a-cast" } } };
`,
    });

    for (const file of Object.keys(virtualFiles)) {
      expect({ file, errors: results[file] }).toEqual({ file, errors: [] });
    }

    expect(results[broken]?.length).toBeGreaterThan(0);
  }, 240_000);
});

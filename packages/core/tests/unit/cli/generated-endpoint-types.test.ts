import { v } from "@warlock.js/seal";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileSources } from "../../../src/tooling/typescript/compiler";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createEndpointGenerator } from "../../../src/cli/commands/generate/generators/endpoint.generator";
import { setDryRun } from "../../../src/cli/commands/generate/utils/writer";

/** Compile generated public and guarded endpoints against the real workspace source
 * using the native compiler's virtual filesystem. A broken schema is a negative control.
 */

const CORE_DIR = path.resolve(__dirname, "../../..").split(path.sep).join("/");
const TEMPLATE_APP = path.resolve(CORE_DIR, "../create-warlock/templates/warlock/src/app");
const VIRTUAL_ROOT = `${CORE_DIR}/__generated-endpoint-types-test__`;

const virtualFiles: Record<string, string> = {};

function compile(files: Record<string, string>): Record<string, string[]> {
  return compileSources(path.join(CORE_DIR, "tsconfig.typecheck.json"), files, {
    "@warlock.js/core/tests": [path.join(CORE_DIR, "src/tests/index.ts")],
    "app/*": [`${VIRTUAL_ROOT}/src/app/*`],
  });
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

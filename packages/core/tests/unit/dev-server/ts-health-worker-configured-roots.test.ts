import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { FileManager } from "../../../src/dev-server/file-manager";
import { TypescriptHealthChecker } from "../../../src/dev-server/health-checker/checkers/typescript-health-checker";

type HealthResult = {
  relativePath: string;
  errors: Array<{ message: string }>;
};

type WorkerResponse =
  | { type: "initialized"; success: boolean }
  | { type: "results"; results: HealthResult[] }
  | { type: "error"; message: string };

const temporaryRoots: string[] = [];

async function createFixture(): Promise<{
  root: string;
  files: Record<"valid" | "unknown" | "unrelated" | "ambient" | "consumer", string>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "warlock-ts-health-"));
  temporaryRoots.push(root);

  const srcDirectory = path.join(root, "src");
  const typingsDirectory = path.join(root, ".warlock", "typings");
  const files = {
    valid: path.join(srcDirectory, "valid.ts"),
    unknown: path.join(srcDirectory, "unknown.ts"),
    unrelated: path.join(srcDirectory, "unrelated.ts"),
    ambient: path.join(srcDirectory, "ambient.ts"),
    consumer: path.join(srcDirectory, "consumer.ts"),
  };

  await Promise.all([
    mkdir(srcDirectory, { recursive: true }),
    mkdir(typingsDirectory, { recursive: true }),
  ]);

  await Promise.all([
    writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "ESNext",
          moduleResolution: "bundler",
          noEmit: true,
          strict: true,
        },
        include: ["src", ".warlock/typings/*.d.ts"],
      }),
    ),
    writeFile(
      path.join(typingsDirectory, "translations.d.ts"),
      'declare module "route-translations" { export function translate(key: "valid"): void; }',
    ),
    writeFile(files.valid, 'import { translate } from "route-translations";\ntranslate("valid");'),
    writeFile(
      files.unknown,
      'import { translate } from "route-translations";\ntranslate("unknown");',
    ),
    writeFile(files.unrelated, "export const unrelated = true;"),
    writeFile(files.ambient, 'declare const deletedOnly: "present";'),
    writeFile(files.consumer, "deletedOnly;"),
  ]);

  return { root, files };
}

function createHealthWorker(): Worker {
  const workerPath = fileURLToPath(
    new URL("../../../src/dev-server/health-checker/workers/ts-health.worker.ts", import.meta.url),
  );

  return new Worker(workerPath, { execArgv: ["--import", "tsx/esm"] });
}

function once(worker: Worker): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: WorkerResponse) => {
      worker.off("error", onError);
      resolve(message);
    };
    const onError = (error: Error) => {
      worker.off("message", onMessage);
      reject(error);
    };

    worker.once("message", onMessage);
    worker.once("error", onError);
  });
}

async function initialize(worker: Worker, root: string): Promise<void> {
  worker.postMessage({ type: "init", config: { cwd: root } });
  await expect(once(worker)).resolves.toEqual({ type: "initialized", success: true });
}

async function check(worker: Worker, files: string[]): Promise<HealthResult[]> {
  worker.postMessage({
    type: "check",
    files: await Promise.all(
      files.map(async (file) => ({
        path: file,
        content: await readFile(file, "utf-8"),
        relativePath: path.relative(path.dirname(path.dirname(file)), file),
      })),
    ),
  });

  const response = await once(worker);
  if (response.type === "error") throw new Error(response.message);
  if (response.type !== "results") throw new Error(`Unexpected worker response: ${response.type}`);
  return response.results;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("TypeScript health worker configured roots", () => {
  it("keeps declarations included by tsconfig while checking and after unrelated updates", async () => {
    const { root, files } = await createFixture();
    const worker = createHealthWorker();

    try {
      await initialize(worker, root);

      const initial = await check(worker, [
        files.valid,
        files.unknown,
        files.ambient,
        files.consumer,
      ]);
      expect(initial.find((result) => result.relativePath.endsWith("valid.ts"))?.errors).toEqual(
        [],
      );
      expect(
        initial.find((result) => result.relativePath.endsWith("unknown.ts"))?.errors,
      ).toHaveLength(1);
      expect(
        initial.find((result) => result.relativePath.endsWith("unknown.ts"))?.errors[0]?.message,
      ).toContain("not assignable");
      expect(initial.find((result) => result.relativePath.endsWith("consumer.ts"))?.errors).toEqual(
        [],
      );

      worker.postMessage({
        type: "fileChanges",
        files: [
          {
            path: files.unrelated,
            content: "export const unrelated = false;",
            relativePath: "src/unrelated.ts",
          },
        ],
      });

      const afterUpdate = await check(worker, [files.valid, files.unknown]);
      expect(
        afterUpdate.find((result) => result.relativePath.endsWith("valid.ts"))?.errors,
      ).toEqual([]);
      expect(
        afterUpdate.find((result) => result.relativePath.endsWith("unknown.ts"))?.errors,
      ).toHaveLength(1);

      await unlink(files.ambient);
      worker.postMessage({
        type: "filesDeleted",
        files: [
          {
            path: files.ambient.replace(/\\/g, "/"),
            relativePath: "src/ambient.ts",
          },
        ],
      });

      const afterDelete = await check(worker, [files.consumer, files.unknown]);
      expect(
        afterDelete.find((result) => result.relativePath.endsWith("consumer.ts"))?.errors[0]
          ?.message,
      ).toContain("Cannot find name 'deletedOnly'");
      expect(
        afterDelete.find((result) => result.relativePath.endsWith("unknown.ts"))?.errors,
      ).toHaveLength(1);
    } finally {
      await worker.terminate();
    }
  }, 30_000);

  it("keeps tsconfig declarations when the inline fallback rebuilds for a source update", async () => {
    const { files, root } = await createFixture();
    const declarationPath = path.join(root, ".warlock", "typings", "translations.d.ts");
    const checker = new TypescriptHealthChecker();
    const parsedConfig = ts.parseJsonConfigFileContent(
      JSON.parse(await readFile(path.join(root, "tsconfig.json"), "utf-8")),
      ts.sys,
      root,
    );

    (checker as unknown as { parsedConfig: ts.ParsedCommandLine }).parsedConfig = parsedConfig;
    await checker.onFileChanges([{ absolutePath: files.unrelated } as FileManager]);

    const program = (checker as unknown as { program: ts.Program }).program;
    const validSource = program.getSourceFile(files.valid);
    const unknownSource = program.getSourceFile(files.unknown);

    expect(program.getSourceFile(declarationPath)).toBeDefined();
    expect(validSource && program.getSemanticDiagnostics(validSource)).toEqual([]);
    expect(unknownSource && program.getSemanticDiagnostics(unknownSource)).toHaveLength(1);
  });
});

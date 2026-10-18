import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import path from "node:path";
import type { Worker } from "node:worker_threads";
import { FileHealthResult } from "../../../src/dev-server/health-checker/file-health-result";
import { createWorker } from "../../../src/dev-server/create-worker";
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
          // This fixture only exercises configured roots. Avoid loading the
          // host project's full standard-library/type-declaration graph.
          noLib: true,
          skipLibCheck: true,
          types: [],
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

async function createHealthWorker(mode: "source" | "published", root: string): Promise<Worker> {
  const workerEntry = new URL(
    "../../../src/dev-server/health-checker/workers/ts-health.worker.ts",
    import.meta.url,
  );
  // Start both paths without inherited loaders, including NODE_OPTIONS hooks.
  const options = { execArgv: [], env: { ...process.env, NODE_OPTIONS: "" } };
  if (mode === "source") {
    return createWorker(
      "../../../src/dev-server/health-checker/workers/ts-health.worker",
      import.meta.url,
      options,
    );
  }

  // pkgist externalizes all declared dependencies, including native packages.
  // Bundling oxc-parser here relocates its binding loader to /tmp and tests a
  // different dependency layout from the published package.
  const builtRoot = path.join(root, "built");
  const manifest: {
    dependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
  } = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
  const result = await build({
    entryPoints: [fileURLToPath(workerEntry)],
    outfile: path.join(builtRoot, "ts-health.worker.mjs"),
    platform: "node",
    target: "node22.15",
    format: "esm",
    bundle: true,
    external: Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }),
    metafile: true,
  });
  const externalImports = Object.values(result.metafile.outputs).flatMap((output) =>
    output.imports.filter((imported) => imported.external).map((imported) => imported.path),
  );
  expect(externalImports).toContain("oxc-parser");
  expect(externalImports).toContain("typescript/unstable/sync");
  // Model core's own installed dependency tree, retaining each package's real
  // location so native optional bindings resolve from their owning package.
  await symlink(
    fileURLToPath(new URL("../../../node_modules", import.meta.url)),
    path.join(root, "node_modules"),
    "junction",
  );
  return createWorker(
    "./ts-health.worker",
    pathToFileURL(path.join(builtRoot, "manager.mjs")).href,
    options,
  );
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
  it.each(["source", "published"] as const)(
    "keeps declarations included by tsconfig in the %s worker after updates and deletions",
    async (mode) => {
      const { root, files } = await createFixture();
      const worker = await createHealthWorker(mode, root);

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
        expect(
          initial.find((result) => result.relativePath.endsWith("consumer.ts"))?.errors,
        ).toEqual([]);

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
        worker.postMessage({ type: "shutdown" });
        await new Promise<void>((resolve) => worker.once("exit", () => resolve()));
      }
    },
    30_000,
  );

  it("keeps tsconfig declarations when the inline fallback rebuilds for a source update", async () => {
    const { files, root } = await createFixture();
    const declarationPath = path.join(root, ".warlock", "typings", "translations.d.ts");
    const checker = new TypescriptHealthChecker().initialize(root);
    try {
      await checker.onFileChanges([
        { absolutePath: files.unrelated, source: "export const unrelated = false;" } as FileManager,
      ]);
      const valid = {
        absolutePath: files.valid,
        relativePath: "src/valid.ts",
        source: await readFile(files.valid, "utf8"),
      } as FileManager;
      const unknown = {
        absolutePath: files.unknown,
        relativePath: "src/unknown.ts",
        source: await readFile(files.unknown, "utf8"),
      } as FileManager;
      expect((await checker.validate(valid, new FileHealthResult())).getStats().errors).toBe(0);
      expect((await checker.validate(unknown, new FileHealthResult())).getStats().errors).toBe(1);
      expect(await readFile(declarationPath, "utf8")).toContain("valid");
    } finally {
      checker.shutdown();
    }
  }, 30_000);
});

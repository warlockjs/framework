import { v } from "@warlock.js/seal";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandActionData } from "../../../../commands/types";
import {
  type GenerationReport,
  runGenerationCommand,
} from "../../../../generations/generation-run";
import { setDryRun } from "../utils/writer";
import {
  createEndpointGenerator,
  pickSchemaExport,
  readEndpointInput,
  schemaModuleFromFile,
} from "./endpoint.generator";

const postInput = v.object({
  title: v.string().min(3),
  views: v.int().min(1).optional(),
  publishedAt: v.date().optional(),
});

/** The `--schema` file's exports, without a TypeScript loader. */
const loadSchemaModule = vi.fn(async () => ({ postInput }) as Record<string, unknown>);

const generateEndpoint = createEndpointGenerator(loadSchemaModule);

const SCHEMA_SOURCE = `import { v } from "@warlock.js/seal";
import { slugRule } from "./rules/slug";

export const postInput = v.object({
  title: v.string().min(3),
});
`;

const data = (args: string[], options: CommandActionData["options"] = {}): CommandActionData => ({
  args,
  options,
});

const modulePath = (...segments: string[]) =>
  path.join(process.cwd(), "src", "app", "posts", ...segments);

const read = (...segments: string[]) => readFile(modulePath(...segments), "utf8");

let tempDir: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "warlock-endpoint-"));
  process.chdir(tempDir);
  await writeFile(path.join(tempDir, "schema.ts"), SCHEMA_SOURCE);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  setDryRun(false);
  vi.restoreAllMocks();
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("readEndpointInput", () => {
  it("defaults to a guarded POST on /<module>, answering with the module's singular resource", () => {
    expect(readEndpointInput(data(["posts/create-post"]))).toMatchObject({
      module: "posts",
      name: "create-post",
      method: "post",
      path: "/posts",
      access: "guarded",
      resource: "Post",
    });
  });

  it("puts an :id in the default path of put, patch and delete", () => {
    expect(readEndpointInput(data(["posts/update-post"], { method: "PATCH" })).path).toBe(
      "/posts/:id",
    );
  });

  it("refuses --auth together with --public, an unknown method and a missing module", () => {
    expect(() => readEndpointInput(data(["posts/x"], { auth: true, public: true }))).toThrow(
      "either --auth or --public",
    );
    expect(() => readEndpointInput(data(["posts/x"], { method: "trace" }))).toThrow(
      'Unknown --method "trace"',
    );
    expect(() => readEndpointInput(data(["create-post"]))).toThrow("<module>/<name>");
  });
});

describe("pickSchemaExport", () => {
  it("prefers the conventional name, else the only object schema, else the default export", () => {
    expect(
      pickSchemaExport({ createPostSchema: postInput, other: postInput }, "createPostSchema")
        .exportName,
    ).toBe("createPostSchema");
    expect(pickSchemaExport({ postInput, notASchema: 1 }, "createPostSchema").exportName).toBe(
      "postInput",
    );
    expect(pickSchemaExport({ default: postInput }, "createPostSchema").exportName).toBe("default");
  });

  it("names the candidates when it cannot choose", () => {
    expect(() => pickSchemaExport({ a: postInput, b: postInput }, "createPostSchema")).toThrow(
      "several object schemas (a, b)",
    );
  });
});

describe("schemaModuleFromFile", () => {
  it("copies a file from outside src/, re-pointing relative imports and adding the conventional names", () => {
    const content = schemaModuleFromFile({
      sourcePath: path.join(tempDir, "schema.ts"),
      source: SCHEMA_SOURCE,
      exportName: "postInput",
      targetPath: modulePath("schema", "create-post.schema.ts"),
      valueName: "createPostSchema",
      typeName: "CreatePostSchema",
    });

    expect(content).toContain('from "../../../../rules/slug"');
    expect(content).toContain("export const createPostSchema = postInput;");
    expect(content).toContain("export type CreatePostSchema = Infer<typeof createPostSchema>;");
    expect(content.startsWith('import type { Infer } from "@warlock.js/seal";')).toBe(true);
  });

  it("imports a file already under src/ instead of copying it", () => {
    const content = schemaModuleFromFile({
      sourcePath: path.join(tempDir, "src", "app", "shared", "post-input.ts"),
      source: SCHEMA_SOURCE,
      exportName: "postInput",
      targetPath: modulePath("schema", "create-post.schema.ts"),
      valueName: "createPostSchema",
      typeName: "CreatePostSchema",
    });

    expect(content).toContain('import { postInput } from "../../shared/post-input";');
    expect(content).toContain("export const createPostSchema = postInput;");
  });
});

describe("make endpoint — writing files", () => {
  it("writes the schema, service, resource, controller, route, locale key and test", async () => {
    await generateEndpoint(data(["posts/create-post"], { schema: "./schema.ts" }));

    const controller = await read("controllers", "create-post.controller.ts");
    const resource = await read("resources", "post.resource.ts");
    const routes = await read("routes.ts");
    const locales = JSON.parse(await read("utils", "locales.json")) as Record<string, unknown>;
    const test = await read("tests", "create-post.test.ts");
    const service = await read("services", "create-post.service.ts");
    const schema = await read("schema", "create-post.schema.ts");

    expect(schema).toContain("export const createPostSchema = postInput;");
    expect(service).toContain("export async function createPostService(input: CreatePostSchema)");

    expect(controller).toContain("request.validated()");
    expect(controller).not.toContain("request.all()");
    expect(controller).toContain("GuardedRequestHandler<CreatePostSchema>");
    expect(controller).toContain('t("posts.createPostSuccess")');
    expect(controller).toContain("createPostController.responseSchema = {\n  201: {");

    expect(resource).toContain('title: "string",');
    expect(resource).toContain('views: "int?",');
    expect(resource).toContain('publishedAt: "date?",');

    expect(routes).toContain('import { guarded } from "app/shared/utils/router";');
    expect(routes).toContain('router.post("/posts", createPostController);');

    expect(locales).toEqual({ createPostSuccess: { en: "Create post completed successfully." } });

    expect(test).toContain('it("rejects an anonymous request"');
    expect(test).toContain("expect(response.status).toBe(401);");
    expect(test).toContain('title: "title sample",');
    expect(test).toContain('delete input["title"];');
  });

  it("marks a --public route public: true and tests it without signing in", async () => {
    await generateEndpoint(data(["posts/create-post"], { schema: "./schema.ts", public: true }));

    const routes = await read("routes.ts");
    const controller = await read("controllers", "create-post.controller.ts");
    const test = await read("tests", "create-post.test.ts");

    expect(routes).toContain('router.post("/posts", createPostController, { public: true });');
    expect(routes).not.toContain("guarded");
    expect(controller).toContain("RequestHandler<Request<CreatePostSchema>>");
    expect(test).not.toContain("actingAs");
    expect(test).toContain('await testPost("/posts", validInput)');
  });

  it("appends to an existing routes.ts and merges into an existing locales.json", async () => {
    await mkdir(modulePath("utils"), { recursive: true });
    await writeFile(
      modulePath("routes.ts"),
      `import { router } from "@warlock.js/core";
import { listPostsController } from "./controllers/list-posts.controller";

router.get("/posts", listPostsController);
`,
    );
    await writeFile(modulePath("utils", "locales.json"), '{ "notFound": { "en": "Not found" } }');

    await generateEndpoint(data(["posts/create-post"], { public: true }));

    const routes = await read("routes.ts");

    expect(routes).toBe(`import { router } from "@warlock.js/core";
import { listPostsController } from "./controllers/list-posts.controller";
import { createPostController } from "./controllers/create-post.controller";

router.get("/posts", listPostsController);

// POST /posts — public on purpose: no auth guard.
router.post("/posts", createPostController, { public: true });
`);
    expect(JSON.parse(await read("utils", "locales.json"))).toEqual({
      notFound: { en: "Not found" },
      createPostSuccess: { en: "Create post completed successfully." },
    });
  });

  it("skips files that exist on a second run, and does not register the route twice", async () => {
    await generateEndpoint(data(["posts/create-post"], { public: true }));
    await writeFile(modulePath("services", "create-post.service.ts"), "// edited by hand\n");

    const stdout: string[] = [];

    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    });

    await runGenerationCommand(
      "make endpoint",
      data(["posts/create-post"], { public: true, json: true }),
      generateEndpoint,
    );

    const report = JSON.parse(stdout.join("")) as GenerationReport;

    expect(await read("services", "create-post.service.ts")).toBe("// edited by hand\n");
    expect(report.written).toEqual([]);
    expect(report.skipped.map((entry) => entry.path)).toEqual([
      "src/app/posts/schema/create-post.schema.ts",
      "src/app/posts/services/create-post.service.ts",
      "src/app/posts/resources/post.resource.ts",
      "src/app/posts/controllers/create-post.controller.ts",
      "src/app/posts/routes.ts",
      "src/app/posts/utils/locales.json",
      "src/app/posts/tests/create-post.test.ts",
    ]);
    expect(report.skipped[1]?.reason).toBe("exists (pass --force to overwrite)");
    expect((await read("routes.ts")).match(/createPostController, \{/g)).toHaveLength(1);
  });

  it("--dry-run --json lists every file it would write and writes none", async () => {
    const stdout: string[] = [];

    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    });

    await runGenerationCommand(
      "make endpoint",
      data(["posts/create-post"], { schema: "./schema.ts", dryRun: true, json: true }),
      generateEndpoint,
    );

    const report = JSON.parse(stdout.join("")) as GenerationReport;

    expect(existsSync(path.join(tempDir, "src"))).toBe(false);
    expect(report).toMatchObject({ ok: true, dryRun: true, command: "make endpoint" });
    expect(report.written).toEqual([
      "src/app/posts/schema/create-post.schema.ts",
      "src/app/posts/services/create-post.service.ts",
      "src/app/posts/resources/post.resource.ts",
      "src/app/posts/controllers/create-post.controller.ts",
      "src/app/posts/routes.ts",
      "src/app/posts/utils/locales.json",
      "src/app/posts/tests/create-post.test.ts",
    ]);
    expect(report.details.endpoint).toMatchObject({
      method: "POST",
      path: "/posts",
      access: "guarded",
      controller: "createPostController",
      resource: "PostResource",
      fields: ["title", "views", "publishedAt"],
    });
  });

  it("fails with the reason when the schema file cannot be loaded", async () => {
    const failing = createEndpointGenerator(async () => {
      throw new Error("Unexpected token");
    });
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(failing(data(["posts/create-post"], { schema: "./schema.ts" }))).rejects.toThrow(
      "exit:1",
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(String(log.mock.calls.at(-1)?.[0])).toContain("Unexpected token");
    expect(existsSync(path.join(tempDir, "src"))).toBe(false);
  });
});

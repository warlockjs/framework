import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WarlockError } from "../../errors/warlock-error";
import { fakeMcpContext } from "./__fixtures__/fake-mcp-context";
import { buildDbSchema } from "./db-schema";
import {
  loadDocsCorpus,
  readDocsFile,
  searchDocs,
  searchTerms,
  splitSections,
} from "./docs-search";
import {
  createWarlockMcpTools,
  describeToolError,
  makeSpecFromInput,
  type WarlockMcpTool,
} from "./mcp-tools";
import { inputSchema, toStandardSchema, validateToolInput } from "./tool-input";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tool(tools: WarlockMcpTool[], name: string): WarlockMcpTool {
  const found = tools.find((candidate) => candidate.name === name);

  if (!found) throw new Error(`no tool ${name}`);

  return found;
}

/** A project with two installed packages' docs under node_modules. */
function docsProject(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "warlock-mcp-docs-"));
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };

  roots.push(root);
  write(
    "node_modules/@warlock.js/core/skills/validate-input/SKILL.md",
    "---\nname: validate-input\n---\n# Validate input\n\nUse request.validated() after a schema.\n\n## File uploads\n\nUpload validation with v.file().\n",
  );
  write(
    "node_modules/@warlock.js/core/README.md",
    "# Core\n\nThe framework core. Validation lives in seal.\n",
  );
  write("node_modules/@warlock.js/cascade/llms.txt", "# Cascade\n\nModels and queries.\n");
  write("node_modules/other/README.md", "# Not ours\n\nvalidation validation validation\n");

  return root;
}

describe("tool input validation", () => {
  const schema = inputSchema(
    {
      name: { type: "string", description: "n" },
      kind: { type: "string", description: "k", enum: ["a", "b"] },
      limit: { type: "integer", description: "l", minimum: 1, maximum: 5 },
      flag: { type: "boolean", description: "f" },
      list: { type: "array", description: "x", items: { type: "string" } },
    },
    ["name"],
  );

  it("accepts valid input and reports every problem of invalid input", () => {
    expect(
      validateToolInput(schema, { name: "x", kind: "a", limit: 2, flag: true, list: ["a"] }),
    ).toEqual([]);
    expect(
      validateToolInput(schema, { kind: "c", limit: 9, flag: "yes", list: [1], extra: 1 }),
    ).toEqual([
      '"name" is required',
      '"kind" must be one of: a, b',
      '"limit" must be at most 5',
      '"flag" must be a boolean',
      '"list" must be an array of strings',
      'unknown argument "extra"',
    ]);
    expect(validateToolInput(schema, "nope")).toEqual(["arguments must be an object"]);
  });

  it("is a Standard Schema with the JSON Schema extension", () => {
    const standard = toStandardSchema(schema);

    expect(standard["~standard"].jsonSchema.input()).toBe(schema);
    expect(standard["~standard"].validate({ name: "x" })).toEqual({ value: { name: "x" } });
    expect(standard["~standard"].validate({})).toEqual({
      issues: [{ message: '"name" is required' }],
    });
  });
});

describe("docs search", () => {
  it("indexes only @warlock.js packages and ranks skills first", async () => {
    const root = docsProject();
    const corpus = await loadDocsCorpus(root);

    expect(corpus.files).toEqual([
      "node_modules/@warlock.js/cascade/llms.txt",
      "node_modules/@warlock.js/core/README.md",
      "node_modules/@warlock.js/core/skills/validate-input/SKILL.md",
    ]);

    const hits = searchDocs(corpus, "upload validation");

    expect(hits[0]).toMatchObject({
      package: "@warlock.js/core",
      source: "skill",
      heading: "File uploads",
    });
    expect(hits.some((hit) => hit.file.includes("other/"))).toBe(false);
    expect(searchDocs(corpus, "models", { package: "@warlock.js/cascade" })).toHaveLength(1);
    expect(searchDocs(corpus, "")).toEqual([]);
  });

  it("reads only corpus files", async () => {
    const root = docsProject();
    const corpus = await loadDocsCorpus(root);

    expect(
      readDocsFile(corpus, root, "node_modules/@warlock.js/core/skills/validate-input/SKILL.md", {
        heading: "File uploads",
      })?.text,
    ).toContain("v.file()");
    expect(readDocsFile(corpus, root, "package.json")).toBeUndefined();
    expect(readDocsFile(corpus, root, "../../etc/passwd")).toBeUndefined();
  });

  it("splits at headings but not inside code fences", () => {
    const sections = splitSections("# A\ntext\n```md\n# not a heading\n```\n## B\nmore", {
      package: "@warlock.js/core",
      file: "x.md",
      source: "skill",
    });

    expect(sections.map((section) => section.heading)).toEqual(["A", "B"]);
    expect(searchTerms("Request.validated() and v.file")).toEqual([
      "request.validated",
      "and",
      "v.file",
    ]);
  });
});

describe("the tool set", () => {
  it("filters inspect sections", async () => {
    const tools = createWarlockMcpTools(fakeMcpContext().context);
    const config = await tool(tools, "inspect_config").run({ filter: "database" });
    const routes = await tool(tools, "inspect_routes").run({ method: "patch" });
    const summary = await tool(tools, "inspect_app").run({});

    expect(config).toMatchObject({ config: [{ key: "database.port" }], total: 2 });
    expect(routes).toMatchObject({ routes: [{ path: "/posts/:id" }] });
    expect(summary).toMatchObject({ counts: { routes: 3, models: 1, config: 2 } });
  });

  it("filters recent devtools requests, newest first, with N+1 flags", async () => {
    const tools = createWarlockMcpTools(fakeMcpContext().context);
    const all = await tool(tools, "requests_recent").run({ details: false });
    const posts = await tool(tools, "requests_recent").run({ path: "/posts" });

    expect(all).toMatchObject({ requests: [{ id: "req-1" }, { id: "req-0" }] });
    expect(posts).toMatchObject({
      devtools: { url: "http://localhost:9", path: "/__warlock" },
      requests: [{ id: "req-1", warnings: [{ type: "n+1" }] }],
    });
  });

  it("passes check and test arguments through", async () => {
    const { context, calls } = fakeMcpContext();
    const tools = createWarlockMcpTools(context);

    await tool(tools, "check_run").run({ changed: true, skip: ["lint", "bogus"] });
    await tool(tools, "test_run").run({ files: ["src/app/posts/a.spec.ts"] });

    expect(calls.checks).toEqual([{ changed: true, base: undefined, skip: ["lint"] }]);
    expect(calls.tests).toEqual([
      { files: ["src/app/posts/a.spec.ts"], changed: false, base: undefined },
    ]);
  });

  it("maps generate_make arguments onto generator flags", () => {
    expect(
      makeSpecFromInput({
        generator: "model",
        name: "posts/post",
        withResource: true,
        table: "posts",
      }),
    ).toEqual({
      type: "make",
      generator: "model",
      name: "posts/post",
      flags: { "with-resource": true, table: "posts" },
    });
    expect(() => makeSpecFromInput({ generator: "nope", name: "x" })).toThrow(/generator/);
  });

  it("explains codes and describes coded failures with their fix", async () => {
    const tools = createWarlockMcpTools(fakeMcpContext().context);

    await expect(tool(tools, "explain").run({ code: "wl8009" })).resolves.toMatchObject({
      code: "WL8009",
      category: "environment",
    });
    await expect(tool(tools, "explain").run({ code: "WL0000" })).rejects.toThrow(
      /Unknown error code/,
    );
    expect(describeToolError(new WarlockError("WL8008", "Not running."))).toMatch(
      /^WL8008: Not running\. Fix: Start `warlock dev`/,
    );
  });
});

describe("db schema", () => {
  it("lists tables sorted, with primary and foreign keys", () => {
    const schema = buildDbSchema([
      {
        name: "Comment",
        table: "comments",
        primaryKey: "id",
        dataSource: null,
        sourceFile: null,
        registered: true,
        columns: [
          { name: "id", required: true, schema: { type: "integer" } },
          { name: "postId", required: true, schema: { type: ["integer", "null"] } },
        ],
        relations: [
          { name: "post", type: "belongsTo", model: "Post", foreignKey: "postId", localKey: null },
        ],
        resource: null,
        deleteStrategy: null,
        createdAtColumn: null,
        updatedAtColumn: null,
        deletedAtColumn: null,
      },
    ]);

    expect(schema).toMatchObject({
      source: "models",
      tables: [
        {
          table: "comments",
          columns: [
            { name: "id", type: "integer", primaryKey: true, references: null },
            { name: "postId", type: "integer|null", references: { model: "Post", column: "id" } },
          ],
        },
      ],
    });
    expect(buildDbSchema([], "x").tables).toEqual([]);
  });
});

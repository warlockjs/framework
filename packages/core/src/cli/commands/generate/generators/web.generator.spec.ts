import { v } from "@warlock.js/seal";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginGenerationRun,
  endGenerationRun,
  runGenerationCommand,
  type GenerationReport,
} from "../../../../generations/generation-run";
import { crudListControllerStub, crudRoutesStub } from "../templates/stubs";
import { crudFiles, formFiles, pageFiles } from "../templates/web-stubs";
import { parseName, pluralName } from "../utils/name-parser";
import { setDryRun } from "../utils/writer";
import {
  createCrudUiGenerator,
  generateForm,
  generatePage,
  listFilters,
  webFields,
  webPath,
} from "./web.generator";

let directory: string;
let previousCwd: string;
beforeEach(async () => {
  previousCwd = process.cwd();
  directory = await mkdtemp(path.join(os.tmpdir(), "warlock-web-generator-"));
  process.chdir(directory);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(async () => {
  setDryRun(false);
  vi.restoreAllMocks();
  process.chdir(previousCwd);
  await rm(directory, { recursive: true, force: true });
});
const read = (file: string) => readFile(path.join(directory, "src", file), "utf8");

async function moduleFixture() {
  const module = pluralName("posts");
  await mkdir("src/app/posts/controllers", { recursive: true });
  await writeFile("src/app/posts/routes.ts", "// Generated routes\n" + crudRoutesStub(module));
  await writeFile(
    "src/app/posts/controllers/list-posts.controller.ts",
    crudListControllerStub(module),
  );
}

describe("web generators", () => {
  it("keeps page policy and behavior out of the UI file", async () => {
    await generatePage({ args: ["account/settings"], options: { interactive: true } });
    expect(await read("web/account/settings.setup.ts")).toContain('path: "/account/settings"');
    expect(await read("web/account/settings.setup.ts")).toContain("metadata:");
    const page = await read("web/account/settings.page.tsx");
    expect(page).toContain("useSettings()");
    expect(page).not.toContain("useState");
    expect(page).not.toContain("export const config");
    expect(await read("web/account/hooks/use-settings.ts")).toContain("useState");
  });

  it("rejects unsafe paths before writing", () => {
    for (const value of [
      "../secrets",
      "/tmp/page",
      "posts/../../file",
      "x;throw",
      "",
      "posts//show",
    ]) {
      expect(() => webPath(value)).toThrow();
    }
  });

  it("generates one shared schema and a guarded optional endpoint without duplicating routes", async () => {
    await moduleFixture();
    const data = { args: ["contact"], options: { module: "posts", endpoint: true } };
    await generateForm(data);
    await generateForm(data);
    const form = await read("web/posts/contact-form.tsx");
    expect(form).toContain('import { Form } from "@mongez/react-form"');
    expect(form).toContain('from "web/design-system/components/text-input"');
    expect(form).toContain('from "shared/schema/posts/contact.schema"');
    expect(form).not.toContain("<input");
    const controller = await read("app/posts/controllers/contact.controller.ts");
    expect(controller).toContain('from "shared/schema/posts/contact.schema"');
    expect(controller).toContain("Controller.responseSchema");
    expect(controller).toContain("Controller.validation = { schema: contactSchema }");
    expect(await read("web/posts/hooks/use-contact-form.ts")).toContain(
      "useSubmitForm<typeof contactSchema>",
    );
    const routes = await read("app/posts/routes.ts");
    expect(routes.match(/formRouter.post/g)).toHaveLength(1);
    expect(routes).toContain("guardForm(() => {");
  });

  it("previews all files and route edits through the generation recorder", async () => {
    await moduleFixture();
    const routes = await read("app/posts/routes.ts");
    beginGenerationRun({ command: "generate form", dryRun: true });
    try {
      await generateForm({
        args: ["contact"],
        options: { module: "posts", endpoint: true, dryRun: true },
      });
    } catch (error) {
      endGenerationRun({ ok: false });
      throw error;
    }
    const report = endGenerationRun({ ok: true });
    expect(report.written).toContain("src/shared/schema/posts/contact.schema.ts");
    expect(report.written).toContain("src/app/posts/routes.ts");
    expect(existsSync("src/web")).toBe(false);
    expect(await read("app/posts/routes.ts")).toBe(routes);
  });

  it("prints the normal JSON report for a dry-run page command", async () => {
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    });
    await runGenerationCommand(
      "generate page",
      { args: ["about"], options: { dryRun: true, json: true } },
      generatePage,
    );
    const report = JSON.parse(stdout.join("")) as GenerationReport;
    expect(report).toMatchObject({ ok: true, dryRun: true, command: "generate page" });
    expect(report.written).toContain("src/web/about.page.tsx");
    expect(existsSync("src/web")).toBe(false);
  });

  it("preserves existing files unless force is explicit", async () => {
    await generatePage({ args: ["about"], options: {} });
    await writeFile("src/web/about.page.tsx", "custom UI");
    await generatePage({ args: ["about"], options: {} });
    expect(await read("web/about.page.tsx")).toBe("custom UI");
    await generatePage({ args: ["about"], options: { force: true } });
    expect(await read("web/about.page.tsx")).toContain("AboutPage");
  });

  it("derives controls from Seal and rejects unsupported fields", () => {
    const fields = webFields(
      v
        .object({ title: v.string(), email: v.string().email(), enabled: v.boolean() })
        .toJsonSchema(),
    );
    expect(fields.map((field) => field.component)).toEqual([
      "TextInput",
      "EmailInput",
      "CheckboxInput",
    ]);
    expect(() => webFields(v.object({ settings: v.object({}) }).toJsonSchema())).toThrow(
      "custom control",
    );
    expect(() => webFields(v.object({ amount: v.number() }).toJsonSchema())).toThrow(
      "custom control",
    );
  });

  it("creates CRUD pages, schema-bound forms, pagination, filters and delete behavior", async () => {
    await moduleFixture();
    const controller = await read("app/posts/controllers/list-posts.controller.ts");
    await writeFile(
      "src/app/posts/controllers/list-posts.controller.ts",
      controller.replace("page: v.numeric()", "title: v.string().optional(),\n  page: v.numeric()"),
    );
    const load = vi.fn(async () => ({
      createPostSchema: v.object({ title: v.string() }),
      updatePostSchema: v.object({ title: v.string() }),
    }));
    await createCrudUiGenerator(load)({ args: ["posts"], options: {} });
    expect(load).toHaveBeenCalledTimes(2);
    expect(await read("web/posts/index.page.tsx")).toContain('name="title"');
    expect(await read("web/posts/hooks/use-list.ts")).toContain(
      'http.get<ListData>("/posts", { params: query })',
    );
    expect(await read("web/posts/index.page.tsx")).toContain("result.pagination.pages");
    expect(await read("web/posts/hooks/use-delete.ts")).toContain('method: "DELETE"');
    expect(await read("web/posts/update-post-form.tsx")).toContain("updatePostSchema");
    expect(await read("web/posts/edit.page.tsx")).toContain('method="PUT"');
    expect(await read("web/posts/hooks/use-edit.ts")).toContain("response.data.post");
    for (const file of ["index", "create", "edit"]) {
      expect(await read(`web/posts/${file}.setup.ts`)).toContain(
        'middleware: [requireUser({ userType: "user" })]',
      );
    }
  });

  it("fails closed for custom route authorization before loading or writing schemas", async () => {
    await moduleFixture();
    await writeFile(
      "src/app/posts/routes.ts",
      crudRoutesStub(pluralName("posts")).replace("guarded(", "customGuard("),
    );
    const load = vi.fn(async () => ({}));
    await expect(createCrudUiGenerator(load)({ args: ["posts"], options: {} })).rejects.toThrow(
      "standard guarded",
    );
    expect(load).not.toHaveBeenCalled();
    expect(existsSync("src/web")).toBe(false);
  });

  it("reads only actual query schema fields", () => {
    expect(
      listFilters(crudListControllerStub(pluralName("posts")), "listPostsQuerySchema"),
    ).toEqual([]);
    expect(() => listFilters("const other = {};", "listPostsQuerySchema")).toThrow();
    expect(
      listFilters(
        `// ignored: v.string()
      const example = { ignored: true };
      const listPostsQuerySchema = v.object({ "search": v.string(), page: v.numeric(), limit: v.numeric() });
    `,
        "listPostsQuerySchema",
      ),
    ).toEqual(["search"]);
    expect(() =>
      listFilters("const listPostsQuerySchema = v.object({ ...other });", "listPostsQuerySchema"),
    ).toThrow("literal field names");
  });

  it("keeps a single default component in each generated UI file", () => {
    const files = {
      ...pageFiles(parseName("about"), "/about", true),
      ...formFiles(
        parseName("contact"),
        "shared/schema/contact.schema",
        "contactSchema",
        [{ name: "name", component: "TextInput" }],
        "/contact",
      ),
      ...crudFiles(pluralName("posts"), []),
    };
    for (const [file, content] of Object.entries(files)) {
      if (!file.endsWith(".tsx")) continue;
      expect(content.match(/export default function /g), file).toHaveLength(1);
      expect(content, file).not.toMatch(/\buse(?:State|Effect)\b/);
      expect(content, file).not.toMatch(/<(?:input|select|textarea)\b/);
    }
  });
});

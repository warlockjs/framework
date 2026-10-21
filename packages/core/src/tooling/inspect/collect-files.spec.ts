import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectFiles, fileRole } from "./collect-files";
import { explainFile, formatFileExplanation } from "./explain-file";
import { inspectApp } from "./inspect-app";
import type { InspectWarning } from "./inspect-report.types";
import type { Route } from "../../router/types";

let root: string;
function write(file: string, source: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), source);
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "warlock-file-graph-"));
  write(
    "base.json",
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "app/*": ["missing/*", "src/app/*"], shared: ["src/shared/index"] },
      },
    }),
  );
  write("tsconfig.json", '{ "extends": "./base.json" }');
  write(
    "src/app/posts/routes.ts",
    'import { list } from "./controllers/list.controller"; export { list };',
  );
  write(
    "src/app/posts/controllers/list.controller.ts",
    'import { load } from "app/posts/services/load.service"; export const list = load;',
  );
  write(
    "src/app/posts/services/load.service.ts",
    'import type { Post } from "shared"; export const load = () => import("../../../shared"); export type Result = Post;',
  );
  write(
    "src/shared/index.ts",
    'export { value as renamed } from "./value"; export type Post = { title: string }; export const { a, b: alias } = { a: 1, b: 2 };',
  );
  write("src/shared/value.ts", 'import "./index"; export default 1; export const value = 1;');
  write(
    "src/web/pages/posts/page.tsx",
    'import { load } from "app/posts/services/load.service"; export default () => <p>{String(load)}</p>;',
  );
  write("src/web/root.tsx", "export default function Root() {}");
  write("src/web/layout.tsx", 'export { value as loader } from "../shared/value";');
  write(
    "src/config/app.ts",
    'throw new Error("static inspection must never execute this"); export default {};',
  );
  write("src/styles.css", "body {}");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("source file inspection", () => {
  it("maps the fixture app, resolving inherited aliases, fallback targets, barrels, cycles and dynamic imports", () => {
    const warnings: InspectWarning[] = [];
    const files = collectFiles(root, warnings);
    expect(warnings).toEqual([]);
    expect(files.find((file) => file.file.endsWith("list.controller.ts"))).toMatchObject({
      module: "src/app/posts",
      role: "controller",
      exports: ["list"],
      imports: [
        {
          specifier: "app/posts/services/load.service",
          file: "src/app/posts/services/load.service.ts",
        },
      ],
      importedBy: ["src/app/posts/routes.ts"],
    });
    expect(files.find((file) => file.file === "src/shared/index.ts")?.exports).toEqual([
      "Post",
      "a",
      "alias",
      "renamed",
    ]);
    expect(files.find((file) => file.file === "src/shared/value.ts")?.exports).toEqual([
      "default",
      "value",
    ]);
    expect(files.find((file) => file.file === "src/styles.css")).toMatchObject({
      exports: [],
      imports: [],
    });
    expect(files.find((file) => file.role === "service")?.imports).toEqual([
      { specifier: "../../../shared", file: "src/shared/index.ts" },
      { specifier: "shared", file: "src/shared/index.ts" },
    ]);
  });

  it("includes type queries and import-equals without executing them", () => {
    write(
      "src/queries.ts",
      'import posts = require("shared"); export type Post = import("shared").Post; export { posts };',
    );
    expect(collectFiles(root).find((file) => file.file === "src/queries.ts")).toMatchObject({
      exports: ["Post", "posts"],
      imports: [{ specifier: "shared", file: "src/shared/index.ts" }],
    });
  });

  it("reports unresolved imports and parse errors without hiding other files", () => {
    write("src/broken.ts", "export const = ;");
    write(
      "src/external.ts",
      'import "node:fs"; export * from "./absent"; export * as posts from "shared";',
    );
    const warnings: InspectWarning[] = [];
    const files = collectFiles(root, warnings);
    expect(warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "src/broken.ts" })]),
    );
    expect(files.find((file) => file.file === "src/external.ts")).toMatchObject({
      exports: ["*", "posts"],
      imports: [
        { specifier: "./absent", file: null },
        { specifier: "node:fs", file: null },
        { specifier: "shared", file: "src/shared/index.ts" },
      ],
    });
  });

  it.each([
    ["src/app/posts/models/post.ts", "model"],
    ["src/app/posts/repositories/post.ts", "repository"],
    ["src/app/posts/migrations/create.ts", "migration"],
    ["src/shared/post.schema.ts", "schema"],
    ["src/shared/post.resource.ts", "resource"],
    ["src/web/hooks/usePosts.ts", "hook"],
    ["src/web/components/Post.tsx", "component"],
    ["src/shared/utils/date.ts", "util"],
    ["src/shared/types/post.ts", "type"],
    ["src/config/app.ts", "config"],
    ["src/web/setup.ts", "setup"],
    ["src/web/root.tsx", "root"],
    ["src/web/layout.tsx", "layout"],
    ["src/shared/post.spec.ts", "spec"],
  ])("infers %s as %s", (file, role) => expect(fileRole(file)).toBe(role));

  it("explains transitive route and page reachability including layouts without looping on cycles", async () => {
    const route: Route = {
      $prefix: "/",
      $prefixStack: [],
      sourceFile: "src/app/posts/routes.ts",
      method: "GET",
      path: "/posts",
      handler: async () => undefined,
    };
    const report = await inspectApp({
      cwd: root,
      sections: ["files", "routes", "pages"],
      routes: [route],
      pages: [{ path: "/posts", file: "src/web/pages/posts/page.tsx" }],
    });
    expect(report.pages?.[0]?.loaders).toEqual(["src/web/layout.tsx"]);
    const file = explainFile(path.join(root, "src/shared/value.ts"), report);
    expect(file.routes.map((entry) => entry.path)).toEqual(["/posts"]);
    expect(file.pages.map((page) => page.path)).toEqual(["/posts"]);
    expect(formatFileExplanation(file).join("\n")).toContain("GET /posts");
    expect(JSON.parse(JSON.stringify(file))).toMatchObject({
      role: "source",
      exports: ["default", "value"],
    });
    expect(() => explainFile("../outside.ts", report)).toThrow(/not found under src/);
  });

  it("provides only the requested files section without loading application modules", async () => {
    const report = await inspectApp({ cwd: root, sections: ["files"] });
    expect(report.sections).toEqual(["files"]);
    expect(report.routes).toBeUndefined();
    expect(report.files?.length).toBe(10);
    expect(report.warnings).toEqual([]);
  });
});

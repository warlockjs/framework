import { describe, expect, it } from "vitest";
import type { BookFacts, BookFile } from "../contracts/adapter";
import type { BookAnnotations } from "../contracts/book";
import { defaultRouteInputs } from "./build";
import { normalizeFacts } from "./normalize";
import { buildEntries, buildModuleSummaries, buildRoutesFile, renderBook, renderModuleSummary } from "./render";

function file(input: Partial<BookFile> & Pick<BookFile, "file" | "module">): BookFile {
  return {
    type: "util",
    lines: 1,
    about: null,
    tags: {},
    exports: [],
    imports: [],
    importedBy: [],
    mobileApp: null,
    ...input,
  };
}

const facts: BookFacts = {
  files: [
    file({
      file: "src/app/blog/routes.ts",
      module: "src/app/blog",
      type: "routes",
      imports: [
        { specifier: "./controllers/posts.controller", file: "src/app/blog/controllers/posts.controller.ts" },
        { specifier: "@warlock.js/core", file: null },
      ],
    }),
    file({
      file: "src/app/blog/controllers/posts.controller.ts",
      module: "src/app/blog",
      type: "controller",
      lines: 12,
      about: "Answers the post requests.",
      exports: [{ name: "PostsController", about: "Lists posts." }],
      imports: [
        { specifier: "@warlock.js/core/tooling", file: null },
        { specifier: "node:path", file: null },
        { specifier: "fs", file: null },
        { specifier: "dayjs/plugin/utc", file: null },
        { specifier: "../../shared/slug", file: "src/app/shared/slug.ts" },
      ],
      importedBy: ["src/app/blog/routes.ts"],
    }),
    file({
      file: "src/app/shared/slug.ts",
      module: "src/app/shared",
      lines: 4,
      importedBy: ["src/app/blog/controllers/posts.controller.ts", "src/web/home.setup.ts"],
    }),
    file({ file: "src/web/home.page.tsx", module: "src/web", type: "page", lines: 8 }),
    file({
      file: "src/web/home.setup.ts",
      module: "src/web",
      type: "setup",
      imports: [{ specifier: "app/shared/slug", file: "src/app/shared/slug.ts" }],
    }),
    file({ file: "src/web/layout.tsx", module: "src/web", type: "layout" }),
    file({ file: "src/config/app.ts", module: "src/config", type: "config" }),
    file({ file: "src/app/blog/mails/welcome.mail.ts", module: "src/app/blog", type: "mail" }),
    file({ file: "phone/app/index.tsx", module: "phone/app", type: "source", mobileApp: "phone" }),
  ],
  routes: [
    {
      method: "GET",
      path: "/posts",
      name: "posts.index",
      sourceFile: "src/app/blog/routes.ts",
      handler: "PostsController.index",
      controller: "PostsController",
      action: "index",
      handlerFile: "src/app/blog/controllers/posts.controller.ts",
      middleware: [],
      auth: { required: false, userTypes: [] },
      isPage: false,
      description: null,
    },
    {
      method: "GET",
      path: "/",
      name: "home",
      sourceFile: null,
      handler: "page",
      controller: null,
      action: null,
      handlerFile: "src/web/home.page.tsx",
      middleware: [],
      auth: { required: false, userTypes: [] },
      isPage: true,
      description: null,
    },
  ],
  sites: [{ id: "default", root: "src/web", basePath: null }],
  pages: [
    {
      site: "default",
      route: "/",
      name: "home",
      file: "src/web/home.page.tsx",
      setupFile: "src/web/home.setup.ts",
      layouts: ["src/web/layout.tsx"],
      loaders: [],
      actions: [],
      requires: [],
      reachedFrom: null,
    },
  ],
  mobile: [
    {
      id: "phone",
      root: "phone",
      routing: "files",
      routesDir: "phone/app",
      screens: [{ route: "/", file: "phone/app/index.tsx", layouts: [] }],
    },
  ],
  named: [],
  tests: [],
};

const annotations: BookAnnotations = {
  writtenHash: "w",
  tests: {},
  files: {
    "src/app/blog/controllers/posts.controller.ts": { feature: "blog", borrowedBy: [], flows: ["blog/read", "blog/list"] },
    "src/app/blog/routes.ts": { feature: "blog", borrowedBy: [], flows: [] },
    "src/app/shared/slug.ts": { feature: null, borrowedBy: ["web", "blog"], flows: [] },
  },
};

describe("book entries", () => {
  const entries = buildEntries(facts, annotations);

  it("lists routes a file registers and routes it handles", () => {
    expect(entries.get("src/app/blog/routes.ts")?.routes).toEqual([
      { method: "GET", path: "/posts", name: "posts.index", via: "registers" },
    ]);
    expect(entries.get("src/app/blog/controllers/posts.controller.ts")?.routes).toEqual([
      { method: "GET", path: "/posts", name: "posts.index", via: "handles" },
    ]);
  });

  it("keeps package names only, without Node builtins, sorted and unique", () => {
    expect(entries.get("src/app/blog/controllers/posts.controller.ts")?.packages).toEqual([
      "@warlock.js/core",
      "dayjs",
    ]);
    expect(entries.get("src/app/blog/controllers/posts.controller.ts")?.imports).toEqual(["src/app/shared/slug.ts"]);
  });

  it("takes feature, borrowers and flows from the annotations, sorted", () => {
    const entry = entries.get("src/app/shared/slug.ts");

    expect(entry?.feature).toBeNull();
    expect(entry?.borrowedBy).toEqual(["blog", "web"]);
    expect(entries.get("src/app/blog/controllers/posts.controller.ts")?.flows).toEqual(["blog/list", "blog/read"]);
    expect(entries.get("src/config/app.ts")).toMatchObject({ feature: null, borrowedBy: [], flows: [] });
  });

  it("links page, setup and layout files to their page, and screens to their app", () => {
    expect(entries.get("src/web/home.page.tsx")?.pages).toEqual([{ site: "default", route: "/", via: "page" }]);
    expect(entries.get("src/web/home.setup.ts")?.pages).toEqual([{ site: "default", route: "/", via: "setup" }]);
    expect(entries.get("src/web/layout.tsx")?.pages).toEqual([{ site: "default", route: "/", via: "layout" }]);
    expect(entries.get("src/web/home.page.tsx")?.routes).toEqual([
      { method: "GET", path: "/", name: "home", via: "handles" },
    ]);
    expect(entries.get("phone/app/index.tsx")?.screens).toEqual([{ app: "phone", route: "/", via: "screen" }]);
  });
});

describe("routes.json", () => {
  it("groups routes by the module of their routes file, (none) for the rest", () => {
    expect(buildRoutesFile(facts)?.modules).toEqual({
      "(none)": [{ method: "GET", path: "/", name: "home", handlerFile: "src/web/home.page.tsx" }],
      "src/app/blog": [
        {
          method: "GET",
          path: "/posts",
          name: "posts.index",
          handlerFile: "src/app/blog/controllers/posts.controller.ts",
        },
      ],
    });
  });

  it("is not written when routes were never collected", () => {
    expect(buildRoutesFile({ ...facts, routes: null })).toBeNull();
    expect([...renderBook({ ...facts, routes: null }, annotations).keys()]).not.toContain(
      "grimoire/book/app/routes.json",
    );
  });
});

describe("module summaries", () => {
  it("collects files, routes, features and users per module", () => {
    const summaries = buildModuleSummaries(facts, annotations);
    const blog = summaries.find((summary) => summary.module === "src/app/blog");
    const shared = summaries.find((summary) => summary.module === "src/app/shared");

    expect(summaries.map((summary) => summary.module)).toEqual([
      "phone/app",
      "src/app/blog",
      "src/app/shared",
      "src/config",
      "src/web",
    ]);
    expect(blog?.features).toEqual(["blog"]);
    expect(blog?.routes).toEqual([{ method: "GET", path: "/posts", name: "posts.index" }]);
    expect(shared?.usedBy).toEqual([
      { module: "src/app/blog", files: 1 },
      { module: "src/web", files: 1 },
    ]);
  });

  it("renders the Markdown format, leaving out empty sections", () => {
    expect(
      renderModuleSummary({
        module: "src/app/catalog",
        features: ["catalog", "orders"],
        files: [
          { file: "src/app/catalog/controllers/x.controller.ts", type: "controller", lines: 10, about: "Answers x." },
          { file: "src/app/catalog/y.ts", type: "util", lines: 1, about: null },
        ],
        routes: [{ method: "GET", path: "/x", name: null }],
        usedBy: [{ module: "src/app/orders", files: 1 }],
      }),
    ).toBe(
      [
        "# src/app/catalog",
        "",
        "Features: catalog, orders. 2 files, 11 lines.",
        "",
        "## Files",
        "- controllers/x.controller.ts  controller  Answers x.",
        "- y.ts  util",
        "",
        "## Routes",
        "- GET /x",
        "",
        "## Used by",
        "- src/app/orders (1 file)",
        "",
      ].join("\n"),
    );
    expect(
      renderModuleSummary({
        module: "src/config",
        features: [],
        files: [{ file: "src/config/app.ts", type: "config", lines: 1, about: null }],
        routes: [],
        usedBy: [],
      }),
    ).toBe("# src/config\n\n1 file, 1 line.\n\n## Files\n- app.ts  config\n");
  });
});

describe("book paths of the rendered files", () => {
  it("never leaves grimoire/book/, even for a file outside the project", () => {
    const outside = { ...facts, files: [...facts.files, file({ file: "../elsewhere/x.ts", module: "../elsewhere" })] };
    const paths = [...renderBook(outside, annotations).keys()];

    expect(paths.every((bookPath) => bookPath.startsWith("grimoire/book/") && !bookPath.includes(".."))).toBe(true);
    expect(paths).toContain("grimoire/book/mobile/phone/app/index.json");
    expect(paths).toContain("grimoire/book/web/default.pages.json");
    expect(paths).toContain("grimoire/book/mobile/phone.screens.json");
  });

  it("gives the same book for Windows-style paths", () => {
    const toWindows = (value: string): string => value.split("/").join("\\");
    const windows: BookFacts = {
      ...facts,
      files: facts.files.map((entry) => ({
        ...entry,
        file: toWindows(entry.file),
        module: toWindows(entry.module),
        imports: entry.imports.map((item) => ({ ...item, file: item.file === null ? null : toWindows(item.file) })),
        importedBy: entry.importedBy.map(toWindows),
      })),
      routes: (facts.routes ?? []).map((route) => ({
        ...route,
        sourceFile: route.sourceFile === null ? null : toWindows(route.sourceFile),
        handlerFile: route.handlerFile === null ? null : `.\\${toWindows(route.handlerFile)}`,
      })),
      pages: facts.pages.map((page) => ({
        ...page,
        file: toWindows(page.file),
        setupFile: page.setupFile === null ? null : toWindows(page.setupFile),
        layouts: page.layouts.map(toWindows),
      })),
    };

    expect(renderBook(normalizeFacts(windows), annotations)).toEqual(renderBook(normalizeFacts(facts), annotations));
  });
});

describe("default route inputs", () => {
  it("covers routes files, what they import, config, named things and the project files", () => {
    expect(defaultRouteInputs(facts.files)).toEqual([
      "package.json",
      "src/app/blog/controllers/posts.controller.ts",
      "src/app/blog/mails/welcome.mail.ts",
      "src/app/blog/routes.ts",
      "src/app/shared/slug.ts",
      "src/config/app.ts",
      "warlock.config.ts",
    ]);
  });
});

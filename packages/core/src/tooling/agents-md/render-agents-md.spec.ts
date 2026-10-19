import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InspectModel, InspectReport, InspectRoute } from "../inspect/inspect-report.types";
import { listInstalledSkills, parseSkillFrontMatter, shortSkillLine } from "./installed-skills";
import { listAppModules, renderAgentsMdSection } from "./render-agents-md";

function route(
  overrides: Partial<InspectRoute> & Pick<InspectRoute, "method" | "path">,
): InspectRoute {
  return {
    name: null,
    sourceFile: "src/app/posts/routes.ts",
    handler: "handler",
    description: null,
    isPage: false,
    middleware: [],
    auth: { required: false, sources: [], userTypes: [] },
    csrf: true,
    rateLimit: { source: "none", max: null, timeWindow: null },
    logging: { body: true, query: true, privateRules: false },
    request: { parameters: [], body: null, customValidation: false },
    responses: {},
    ...overrides,
  };
}

function model(name: string, table: string, sourceFile: string): InspectModel {
  return {
    name,
    table,
    primaryKey: "id",
    dataSource: null,
    sourceFile,
    registered: true,
    columns: [],
    relations: [],
    resource: null,
    deleteStrategy: null,
    createdAtColumn: null,
    updatedAtColumn: null,
    deletedAtColumn: null,
  };
}

function report(routes: InspectRoute[]): InspectReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    app: {
      name: "blog",
      version: "1.2.0",
      root: "/tmp/blog",
      node: "v22.15.0",
      environment: "development",
      runtimeStrategy: "development",
    },
    sections: ["routes", "models", "packages"],
    routes,
    models: [
      model("User", "users", "src/app/users/models/user/user.model.ts"),
      model("Post", "posts", "src/app/posts/models/post/post.model.ts"),
    ],
    packages: [
      { name: "@warlock.js/seal", version: "5.31.0" },
      { name: "@warlock.js/core", version: "5.31.0" },
    ],
    components: { schemas: {} },
    warnings: [],
  };
}

const routes = [
  route({ method: "POST", path: "/posts", name: "posts.create" }),
  route({
    method: "PATCH",
    path: "/posts/:id",
    auth: { required: true, sources: ["header"], userTypes: ["user"] },
  }),
  route({ method: "GET", path: "/posts", name: "posts.list" }),
  route({ method: "GET", path: "/users", sourceFile: "src/app/users/routes.ts" }),
];

const directories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "warlock-agents-md-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("renderAgentsMdSection", () => {
  it("renders the app, modules, routes, models, conventions and verify commands", () => {
    const section = renderAgentsMdSection(report(routes), { modules: ["empty"] });

    expect(section).toContain("## blog 1.2.0 — generated facts");
    expect(section).toContain("`@warlock.js/core@5.31.0`, `@warlock.js/seal@5.31.0`");
    expect(section).toContain("| `posts` | 3 | 1 |");
    expect(section).toContain("| `users` | 1 | 1 |");
    expect(section).toContain("| `empty` | 0 | 0 |");
    expect(section).toContain("4 route(s): 2 GET, 1 POST, 1 PATCH.");
    expect(section).toContain(
      "Mutating routes without an auth guard (confirm each is meant to be public): `POST /posts`.",
    );
    expect(section).toContain("- `PATCH /posts/:id` [auth]");
    expect(section).toContain("- `Post` → `posts` (module `posts`)");
    expect(section).toContain("(`WL9002`)");
    expect(section).toContain("or says `public: true` (`WL9006`)");
    expect(section).toContain("npx warlock check --changed --json");
    expect(section).not.toContain("2026-01-01");
  });

  it("is deterministic regardless of input order", () => {
    const first = renderAgentsMdSection(report(routes));
    const second = renderAgentsMdSection(report([...routes].reverse()));

    expect(second).toBe(first);
    expect(first.indexOf("- `GET /posts`")).toBeLessThan(first.indexOf("- `POST /posts`"));
  });

  it("caps the route list and points at warlock inspect", () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      route({ method: "GET", path: `/r${index}` }),
    );
    const section = renderAgentsMdSection(report(many), { maxRoutes: 2 });

    expect(section).toContain("- +3 more — run `npx warlock inspect --json --section routes`");
  });

  it("lists skills by package with their first sentence", () => {
    const section = renderAgentsMdSection(report([]), {
      skills: [
        {
          package: "@warlock.js/core",
          slug: "warlock-inspect",
          name: "warlock-inspect",
          description: "Ask the app instead of grepping it. Triggers: inspect.",
          file: "node_modules/@warlock.js/core/skills/warlock-inspect/SKILL.md",
        },
      ],
    });

    expect(section).toContain("**@warlock.js/core**");
    expect(section).toContain("- `warlock-inspect` — Ask the app instead of grepping it.");
  });
});

describe("installed skills", () => {
  it("reads every SKILL.md under node_modules/@warlock.js/*/skills", () => {
    const cwd = temporaryDirectory();
    const write = (file: string, content: string) => {
      mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
      writeFileSync(path.join(cwd, file), content);
    };

    write(
      "node_modules/@warlock.js/core/skills/warlock-check/SKILL.md",
      "---\nname: warlock-check\ndescription: 'Verify a change. It''s one command.'\n---\n\n# Body\n",
    );
    write("node_modules/@warlock.js/core/skills/index.md", "Package orientation, not a topic.");
    write("node_modules/@warlock.js/ai/skills/run-agent/SKILL.md", "# no front matter\n");
    mkdirSync(path.join(cwd, "node_modules/@warlock.js/fs/skills/empty"), { recursive: true });

    expect(listInstalledSkills(cwd)).toEqual([
      {
        package: "@warlock.js/ai",
        slug: "run-agent",
        name: "run-agent",
        description: "",
        file: "node_modules/@warlock.js/ai/skills/run-agent/SKILL.md",
      },
      {
        package: "@warlock.js/core",
        slug: "warlock-check",
        name: "warlock-check",
        description: "Verify a change. It's one command.",
        file: "node_modules/@warlock.js/core/skills/warlock-check/SKILL.md",
      },
    ]);
  });

  it("returns nothing without node_modules", () => {
    expect(listInstalledSkills(temporaryDirectory())).toEqual([]);
  });

  it("parses quoted front matter and shortens descriptions", () => {
    expect(parseSkillFrontMatter('---\nname: x\ndescription: "a \\"b\\""\n---\n')).toEqual({
      name: "x",
      description: 'a "b"',
    });
    expect(shortSkillLine("First sentence. Second one.")).toBe("First sentence.");
    expect(shortSkillLine("a".repeat(200), 10)).toBe(`${"a".repeat(9)}…`);
  });

  it("lists module folders under src/app", () => {
    const cwd = temporaryDirectory();

    mkdirSync(path.join(cwd, "src/app/users"), { recursive: true });
    mkdirSync(path.join(cwd, "src/app/posts"), { recursive: true });
    writeFileSync(path.join(cwd, "src/app/main.ts"), "");

    expect(listAppModules(cwd)).toEqual(["posts", "users"]);
  });
});

import * as ast from "../syntax/ast";
import { describe, expect, it } from "vitest";
import { checkFileConventions } from "./conventions-step";
import { applyFixes } from "./fixes";
import {
  collectModelFacts,
  EMPTY_MODEL_FACTS,
  modelFactsOf,
  modelMergeFindings,
  modelPropertyReadFindings,
  type ModelFacts,
} from "./model-property-reads";

const USER_MODEL = `
  import { Model } from "@warlock.js/cascade";
  import { v } from "@warlock.js/seal";

  export class User extends Model {
    public static table = "users";
    public static schema = v.object({
      name: v.string().required(),
      email: v.string().email().required(),
    }).allowUnknown();

    public get displayName() {
      return this.get("name");
    }
  }
`;

function check(source: string, facts: ModelFacts = EMPTY_MODEL_FACTS, file = "src/app/a.ts") {
  const sourceFile = ast.parseSourceFile(file, source);

  return modelPropertyReadFindings(sourceFile, facts).map((finding) => ({
    code: finding.code,
    severity: finding.severity,
    text: ast.textOf(finding.node),
    message: finding.message,
    fix: finding.fix,
  }));
}

function fixed(source: string, facts?: ModelFacts): string {
  const sourceFile = ast.parseSourceFile("src/app/a.ts", source);
  const fixes = modelPropertyReadFindings(sourceFile, facts).flatMap((finding) =>
    finding.fix ? [finding.fix] : [],
  );

  return applyFixes(source, fixes);
}

describe("WL9021 a column read as a property", () => {
  it("flags a column read on an instance found by a finder", () => {
    const found = check(`${USER_MODEL}
      async function show() {
        const user = await User.find(1);
        return user.email;
      }`);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: "WL9021",
      severity: "warning",
      text: "user.email",
      message: expect.stringContaining('`user.get("email")`'),
    });
  });

  it("flags reads on new instances, annotated parameters and this", () => {
    const found = check(`${USER_MODEL}
      const made = new User({ name: "a" });
      made.name;
      function greet(user: User | null) { return user?.name; }
      export class Admin extends User {
        public label() { return this.email; }
      }`);

    expect(found.map((item) => item.text)).toEqual(["made.name", "user?.name", "this.email"]);
  });

  it("leaves Model API, custom members, method calls and unknown names alone", () => {
    expect(
      check(`${USER_MODEL}
        async function show() {
          const user = await User.findOrFail(1);
          user.id;
          user.createdAt;
          user.displayName;
          user.get("email");
          user.save();
          user.posts;
          user.notAColumn;
          return user.email();
        }`),
    ).toEqual([]);
  });

  it("ignores variables declared more than once, and non-model classes", () => {
    expect(
      check(`${USER_MODEL}
        async function a() { const item = await User.find(1); return item; }
        function b() { const item = { email: 1 }; return item.email; }
        class Plain { public static schema = { email: 1 }; }
        const plain = new Plain();
        plain.email;`),
    ).toEqual([]);
  });

  it("does not guess when the schema cannot be read", () => {
    expect(
      check(`
        import { Model } from "@warlock.js/cascade";
        import { shared } from "./shared";
        export class Thing extends Model { public static schema = shared; }
        async function f() { const thing = await Thing.first(); return thing.email; }`),
    ).toEqual([]);
  });

  it("reads a schema held in a constant of the same file", () => {
    const found = check(`
      import { Model } from "@warlock.js/cascade";
      import { v } from "@warlock.js/seal";
      const schema = v.object({ title: v.string() });
      export class Post extends Model { public static schema = schema; }
      async function f() { const post = await Post.first(); return post.title; }`);

    expect(found).toHaveLength(1);
  });

  it("uses model classes from other files and inherited columns", () => {
    const base = modelFactsOf(ast.parseSourceFile("src/app/users/user.model.ts", USER_MODEL));
    const found = check(
      `import { User } from "app/users/models/user";
       class Staff extends User {}
       async function f() { const staff = await Staff.first(); return staff.email; }`,
      new Map([
        ...base,
        ["Staff", { parent: "User", columns: undefined, members: new Set<string>() }],
      ]),
    );

    expect(found).toHaveLength(1);
  });

  it("skips test files", () => {
    expect(
      check(
        `${USER_MODEL}
         async function f() { const user = await User.find(1); return user.email; }`,
        EMPTY_MODEL_FACTS,
        "src/app/a.spec.ts",
      ),
    ).toEqual([]);
  });

  it("flags assignments with a set() message", () => {
    const found = check(`${USER_MODEL}
      async function f() { const user = await User.find(1); user.name = "b"; }`);

    expect(found[0]?.message).toContain('`user.set("name", value)`');
  });
});

describe("WL9021 fixes", () => {
  const prelude = `${USER_MODEL}\n`;

  it("rewrites reads to get()", () => {
    expect(
      fixed(
        `${prelude}async function f() { const user = await User.find(1); return user.email.trim(); }`,
      ),
    ).toContain('return user.get("email").trim();');
  });

  it("keeps optional chaining", () => {
    expect(fixed(`${prelude}function f(user: User | null) { return user?.name; }`)).toContain(
      'return user?.get("name");',
    );
  });

  it("rewrites a plain assignment statement to set()", () => {
    expect(
      fixed(`${prelude}async function f() { const user = await User.find(1); user.name = "b"; }`),
    ).toContain('user.set("name", "b");');
  });

  it("does not fix compound assignments", () => {
    const source = `${prelude}async function f() { const user = await User.find(1); user.name += "b"; }`;

    expect(fixed(source)).toBe(source);
  });

  it("fixes this reads inside a model class", () => {
    expect(
      fixed(`${prelude}export class Admin extends User { public label() { return this.email; } }`),
    ).toContain('return this.get("email");');
  });
});

describe("WL9021 through the conventions step", () => {
  it("reports a warning with a fix and honours the ignore comment", () => {
    const source = `${USER_MODEL}
      async function a() {
        const user = await User.find(1);
        // warlock-check-ignore WL9021
        const quiet = user.email;
        return user.name;
      }`;
    const problems = checkFileConventions("src/app/users/a.ts", source, "/nonexistent").filter(
      (problem) => problem.code === "WL9021",
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ severity: "warning" });
    expect(problems[0]?.fix).toBeDefined();
  });

  it("collects model facts from files on disk", () => {
    expect(collectModelFacts("/nonexistent", ["src/app/missing.ts"]).size).toBe(0);
  });
});

describe("WL9025 merge() on an object column", () => {
  const REPORT_MODEL = `
    import { Model } from "@warlock.js/cascade";
    import { v } from "@warlock.js/seal";

    export class Report extends Model {
      public static schema = v.object({
        name: v.string().required(),
        filters: v.object({ status: v.string() }).optional(),
        extras: v.record(v.string()).optional(),
        rows: v.array(v.object({ a: v.string() })).optional(),
        tags: v.array(v.string()).optional(),
      });
    }
  `;

  function mergeFindings(source: string, facts: ModelFacts = EMPTY_MODEL_FACTS) {
    return modelMergeFindings(ast.parseSourceFile("src/app/a.ts", source), facts);
  }

  it("flags an object column in a merge literal", () => {
    const found = mergeFindings(`${REPORT_MODEL}
      async function update() {
        const report = await Report.find(1);
        report.merge({ name: "x", filters: { status: "closed" } });
      }`);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ code: "WL9025", severity: "warning" });
    expect(found[0].fix).toBeUndefined();
    expect(found[0].message).toContain("`filters` column (object)");
    expect(found[0].message).toContain("set({ filters: ... })");
    expect(found[0].message).not.toContain("assign");
  });

  it("flags record and array-of-objects columns, naming the type", () => {
    const found = mergeFindings(`${REPORT_MODEL}
      function update(report: Report) {
        report.merge({ extras: {}, rows: [] });
      }`);

    expect(found.map((finding) => finding.message)).toEqual([
      expect.stringContaining("`extras` column (record)"),
      expect.stringContaining("`rows` column (array of objects)"),
    ]);
  });

  it("flags this.merge inside a model class and shorthand keys", () => {
    const found = mergeFindings(`${REPORT_MODEL}
      export class Child extends Report {
        public reset(filters: unknown) {
          this.merge({ filters });
        }
      }`);

    expect(found).toHaveLength(1);
  });

  it("does not flag scalar or array-of-scalar columns", () => {
    const found = mergeFindings(`${REPORT_MODEL}
      function update(report: Report) {
        report.merge({ name: "x", tags: ["a"] });
      }`);

    expect(found).toEqual([]);
  });

  it("does not flag set()", () => {
    const found = mergeFindings(`${REPORT_MODEL}
      function update(report: Report) {
        report.set({ filters: { status: "closed" }, "settings.theme": "dark" });
        report.set("filters", { status: "closed" });
      }`);

    expect(found).toEqual([]);
  });

  it("does not flag merge on a non-model receiver", () => {
    const found = mergeFindings(`${REPORT_MODEL}
      import _ from "lodash";
      class Bag { merge(values: object) { return values; } }
      function update(bag: Bag) {
        const copy = new Bag();
        copy.merge({ filters: { a: 1 } });
        bag.merge({ filters: { a: 1 } });
        _.merge({}, { filters: { a: 1 } });
      }`);

    expect(found).toEqual([]);
  });

  it("does not flag a merge of a variable or a spread", () => {
    const found = mergeFindings(`${REPORT_MODEL}
      function update(report: Report, values: Record<string, unknown>) {
        report.merge(values);
        report.merge({ ...values });
      }`);

    expect(found).toEqual([]);
  });

  it("uses facts gathered from other files, and a subclass column shadows the parent's", () => {
    const facts = new Map(modelFactsOf(ast.parseSourceFile("src/app/report.ts", REPORT_MODEL)));
    const found = mergeFindings(
      `function update(report: Report) { report.merge({ filters: {} }); }`,
      facts,
    );

    expect(found).toHaveLength(1);

    const shadowed = new Map(facts).set("Plain", {
      parent: "Report",
      columns: new Set(["filters"]),
      members: new Set<string>(),
      objectColumns: new Map(),
    });

    expect(
      mergeFindings(`function update(p: Plain) { p.merge({ filters: {} }); }`, shadowed),
    ).toEqual([]);
  });

  it("is reported by the file check as WL9025", () => {
    const problems = checkFileConventions(
      "src/app/users/a.ts",
      `${REPORT_MODEL}
      function update(report: Report) { report.merge({ filters: {} }); }`,
      "/nonexistent",
    );

    expect(problems.map((problem) => problem.code)).toContain("WL9025");
  });
});

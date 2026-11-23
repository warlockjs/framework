import { describe, expect, it } from "vitest";
import type { GuardInput, TaskScope } from "../contracts/guard";
import { DEFAULT_GRIMOIRE_SETTINGS } from "../contracts/settings";
import type { ProofLine } from "../contracts/test-results";
import type { WrittenFlow, WrittenGrimoire } from "../contracts/written";
import type { ChangedFile } from "../git";
import { countAssertions } from "./assertions";
import { matchesGlob, splitList } from "./glob";
import { runGuardChecks } from "./rules";
import { findTask, parseRemoveEntry, readTaskScope } from "./scope";
import { describeRouteDiff, diffRoutes } from "./api";

const emptyWritten = (features: WrittenGrimoire["features"] = []): WrittenGrimoire => ({
  root: "/p",
  exists: true,
  features,
  apps: [],
  tasks: [],
  releases: [],
  settings: null,
  hash: "",
});

const scope = (patch: Partial<TaskScope> = {}): TaskScope => ({
  id: "T-20",
  file: "grimoire/tasks/open/T-020-new-arrivals.md",
  feature: "catalog",
  flow: "catalog/new-arrivals",
  features: ["catalog"],
  files: [],
  locked: [],
  touches: [],
  removes: [],
  ...patch,
});

const change = (
  file: string,
  status: ChangedFile["status"] = "modified",
  addedLines: number[] = [],
): ChangedFile => ({
  file,
  status,
  from: null,
  addedLines,
});

/** A task whose `Files:` allows everything, for specs that are not about the scope. */
const wide = (patch: Partial<TaskScope> = {}): TaskScope => scope({ files: ["**"], ...patch });

const input = (patch: Partial<GuardInput> = {}): GuardInput => ({
  scope: scope(),
  changed: [],
  texts: {},
  ownership: {
    files: {
      "src/app/catalog/a.ts": {
        file: "src/app/catalog/a.ts",
        owner: "catalog",
        via: "folder",
        folder: null,
        conflicts: [],
        borrowedBy: [],
      },
    },
    features: { catalog: { own: ["src/app/catalog/a.ts"], borrowed: [] } },
  },
  flowFiles: { "catalog/new-arrivals": ["src/app/shared/money.ts"] },
  proofs: [],
  baseWritten: null,
  written: emptyWritten(),
  settings: DEFAULT_GRIMOIRE_SETTINGS,
  testFiles: [],
  api: { approved: null, routes: null },
  commits: null,
  taskIds: ["T-20"],
  ...patch,
});

const codes = (checked: GuardInput): string[] =>
  runGuardChecks(checked).map(
    (finding) => `${finding.code}${finding.at ? `@${finding.at.file}` : ""}`,
  );

const flow = (id: string, criteria: string[], cases: string[]): WrittenFlow =>
  ({
    file: `grimoire/features/catalog/flows/${id}.md`,
    feature: "catalog",
    id: { value: id, at: { file: "", line: 1, column: null } },
    ref: `catalog/${id}`,
    criteria: criteria.map((name, index) => ({
      id: name,
      number: index + 1,
      app: null,
      text: `text of ${name}`,
      at: { file: "", line: 1, column: null },
    })),
    cases: cases.map((question) => ({
      question,
      fixed: true,
      answer: "x",
      doesNotApply: false,
      criteria: [],
      at: { file: "", line: 1, column: null },
    })),
  }) as unknown as WrittenFlow;

const writtenWith = (...flows: WrittenFlow[]): WrittenGrimoire =>
  emptyWritten([
    { id: "catalog", flows, readme: null } as unknown as WrittenGrimoire["features"][number],
  ]);

describe("scope (GR7006)", () => {
  it("allows owned files, the flow's files, the task file and Files: globs", () => {
    const checked = input({
      scope: scope({ files: ["src/config/catalog.ts", "docs/**"], touches: ["config"] }),
      changed: [
        change("src/app/catalog/a.ts"),
        change("src/app/shared/money.ts"),
        change("grimoire/tasks/open/T-020-new-arrivals.md"),
        change("grimoire/features/catalog/flows/new-arrivals.md"),
        change("src/config/catalog.ts"),
        change("docs/deep/page.md"),
        change("src/app/orders/other.ts", "added"),
      ],
    });

    expect(codes(checked)).toEqual(["GR7006@src/app/orders/other.ts"]);
  });

  it("allows the tests that prove the task's criteria and the features named in Features:", () => {
    const proof = {
      feature: "catalog",
      flow: "new-arrivals",
      ref: "catalog/new-arrivals",
      criterion: "AC-1",
      test: null,
      at: { file: "src/app/catalog/tests/n.test.ts", line: 1, column: null },
    } as ProofLine;
    const checked = input({
      scope: scope({ features: ["catalog", "orders"] }),
      proofs: [proof],
      ownership: {
        files: {},
        features: {
          catalog: { own: [], borrowed: [] },
          orders: { own: ["src/app/orders/x.ts"], borrowed: [] },
        },
      },
      changed: [change("src/app/catalog/tests/n.test.ts"), change("src/app/orders/x.ts")],
    });

    expect(codes(checked)).toEqual([]);
  });

  it("checks both sides of a rename", () => {
    const checked = input({
      changed: [
        {
          file: "src/app/catalog/a.ts",
          status: "renamed",
          from: "src/app/orders/old.ts",
          addedLines: [],
        },
      ],
    });

    expect(codes(checked)).toEqual(["GR7006@src/app/catalog/a.ts"]);
  });
});

describe("removals (GR7007)", () => {
  const base = writtenWith(
    flow("new-arrivals", ["AC-1", "AC-2"], ["duplicate", "expiry"]),
    flow("browse", ["AC-1"], []),
  );

  it("reports a removed flow, criterion and case", () => {
    const written = writtenWith(flow("new-arrivals", ["AC-1"], ["duplicate"]));
    const messages = runGuardChecks(input({ baseWritten: base, written })).map(
      (finding) => finding.message,
    );

    expect(messages).toEqual([
      expect.stringContaining("removes AC-2 of catalog/new-arrivals"),
      expect.stringContaining('removes the case "expiry"'),
      expect.stringContaining('removes the flow "catalog/browse"'),
    ]);
  });

  it("lets Removes: name each level", () => {
    const written = writtenWith(flow("new-arrivals", ["AC-1"], ["duplicate"]));
    const removes = [
      "catalog/new-arrivals AC-2",
      "catalog/new-arrivals case expiry",
      "catalog/browse",
    ].map(parseRemoveEntry);

    expect(
      runGuardChecks(input({ scope: scope({ removes }), baseWritten: base, written })),
    ).toEqual([]);
    expect(
      runGuardChecks(
        input({
          scope: scope({ removes: [parseRemoveEntry("catalog")] }),
          baseWritten: base,
          written,
        }),
      ),
    ).toEqual([]);
  });

  it("reports a removed feature once", () => {
    const findings = runGuardChecks(input({ baseWritten: base, written: emptyWritten() }));

    expect(findings.map((finding) => finding.code)).toEqual(["GR7007"]);
  });
});

describe("deleted proofs (GR7008)", () => {
  const test = (extra = "") => `// @proves catalog/new-arrivals AC-1\nit("a", () => {});\n${extra}`;

  it("reports a deleted proving test and accepts a moved one", () => {
    const deleted = input({
      changed: [change("src/app/catalog/t.test.ts", "deleted")],
      texts: { "src/app/catalog/t.test.ts": { base: test(), current: null } },
    });

    expect(codes(deleted)).toContain("GR7008@src/app/catalog/t.test.ts");

    const moved = input({
      scope: wide(),
      changed: [
        change("src/app/catalog/t.test.ts", "deleted"),
        change("src/app/catalog/u.test.ts", "added"),
      ],
      texts: {
        "src/app/catalog/t.test.ts": { base: test(), current: null },
        "src/app/catalog/u.test.ts": { base: null, current: test() },
      },
    });

    expect(codes(moved).filter((code) => code.startsWith("GR7008"))).toEqual([]);
  });

  it("accepts a deleted proof the task removes", () => {
    const checked = input({
      scope: wide({ removes: [parseRemoveEntry("catalog/new-arrivals AC-1")] }),
      changed: [change("src/app/catalog/t.test.ts", "deleted")],
      texts: { "src/app/catalog/t.test.ts": { base: test(), current: null } },
    });

    expect(codes(checked)).toEqual([]);
  });
});

describe("locked tests and assertions (GR7009, GR7010)", () => {
  it("flags any change to a locked test", () => {
    const checked = input({
      scope: scope({ locked: ["src/app/catalog/tests/**"] }),
      changed: [change("src/app/catalog/tests/n.test.ts")],
    });

    expect(codes(checked)).toContain("GR7009@src/app/catalog/tests/n.test.ts");
  });

  it("warns when a changed test has fewer assertions", () => {
    const file = "src/app/catalog/tests/n.test.ts";
    const checked = input({
      scope: wide(),
      changed: [change(file)],
      texts: {
        [file]: {
          base: "expect(a).toBe(1);\nexpect(b).toBe(2);\nassert.equal(c, 3);",
          current: "expect(a).toBe(1);",
        },
      },
    });
    const [finding] = runGuardChecks(checked);

    expect(finding?.code).toBe("GR7010");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("1 assertions, it had 3");
  });

  it("counts expect, expect.soft, assert, assert.x and .should, not strings or comments", () => {
    const text =
      'expect(a).toBe(1); expect.soft(b); assert(c); assert.equal(d, 1); x.should("y"); // expect(z)\nconst s = "expect(q)";';

    expect(countAssertions(text)).toBe(5);
  });
});

describe("protected areas (GR7011)", () => {
  const pkg = (dependencies: Record<string, string>) =>
    JSON.stringify({ name: "app", dependencies });

  it("flags protected files the task does not touch-name, and accepts Touches:", () => {
    const changed = [
      change("src/app/catalog/migrations/001.ts"),
      change("pnpm-lock.yaml"),
      change("src/config/catalog.ts"),
    ];
    const flagged = runGuardChecks(input({ changed, scope: wide() }));

    expect(flagged.map((finding) => finding.code)).toEqual(["GR7011", "GR7011", "GR7011"]);

    const named = runGuardChecks(
      input({ changed, scope: wide({ touches: ["migrations", "lockfile", "config"] }) }),
    );

    expect(named).toEqual([]);
  });

  it("flags a package.json edit only when it adds or changes a dependency", () => {
    const base = pkg({ a: "1.0.0" });
    const same = input({
      scope: wide(),
      changed: [change("package.json")],
      texts: {
        "package.json": {
          base,
          current: JSON.stringify({ name: "renamed", dependencies: { a: "1.0.0" } }),
        },
      },
    });
    const added = input({
      scope: wide(),
      changed: [change("package.json")],
      texts: { "package.json": { base, current: pkg({ a: "1.0.0", b: "2.0.0" }) } },
    });

    expect(runGuardChecks(same)).toEqual([]);

    const [finding] = runGuardChecks(added);

    expect(finding?.code).toBe("GR7011");
    expect(finding?.message).toContain("b@2.0.0");
  });

  it("flags a public API difference unless the task names public-api", () => {
    const api = {
      approved: { schemaVersion: 1 as const, approvedAt: "", routes: ["GET /a"] },
      routes: ["GET /a", "POST /b"],
    };

    expect(codes(input({ api }))).toEqual(["GR7011@grimoire/approved/api.json"]);
    expect(codes(input({ api, scope: scope({ touches: ["public-api"] }) }))).toEqual([]);
    expect(codes(input({ api: { approved: null, routes: ["GET /a"] } }))).toEqual([]);
  });

  it("uses the areas of the settings", () => {
    const settings = {
      ...DEFAULT_GRIMOIRE_SETTINGS,
      protected: [{ name: "payments", globs: ["src/app/payments/**"] }],
    };
    const checked = input({ settings, scope: wide(), changed: [change("src/app/payments/x.ts")] });

    expect(codes(checked)).toEqual(["GR7011@src/app/payments/x.ts"]);
  });
});

describe("added lines (GR3007-GR3010, GR4011, GR4012)", () => {
  it("runs the rules on added lines only", () => {
    const file = "src/app/catalog/a.tsx";
    const text = 'const old = "ml-4";\nconst fresh = "mr-2";\n';
    const checked = input({
      scope: wide(),
      changed: [change(file, "modified", [2])],
      texts: { [file]: { base: "", current: text } },
    });

    expect(runGuardChecks(checked).map((finding) => `${finding.code}:${finding.at?.line}`)).toEqual(
      ["GR3007:2"],
    );
  });

  it("honours the rules of the settings", () => {
    const file = "src/app/catalog/a.tsx";
    const current = 'const a = "mr-2"; import x from "./x.js";';
    const patch = {
      scope: wide(),
      changed: [change(file, "added", [1])],
      texts: { [file]: { base: null, current } },
    };

    expect(
      runGuardChecks(
        input({ ...patch, settings: { ...DEFAULT_GRIMOIRE_SETTINGS, rules: ["no-js-imports"] } }),
      ).map((finding) => finding.code),
    ).toEqual(["GR3010"]);
    expect(
      runGuardChecks(input({ ...patch, settings: { ...DEFAULT_GRIMOIRE_SETTINGS, rules: [] } })),
    ).toEqual([]);
  });

  it("makes an added .only or .skip an error", () => {
    const file = "src/app/catalog/tests/n.test.ts";
    const checked = input({
      scope: wide(),
      changed: [change(file, "modified", [2, 3])],
      texts: {
        [file]: {
          base: "",
          current: 'it("a", () => {});\nit.only("b", () => {});\ndescribe.skip("c", () => {});',
        },
      },
    });
    const findings = runGuardChecks(checked);

    expect(findings.map((finding) => `${finding.code}:${finding.severity}`)).toEqual([
      "GR4011:error",
      "GR4012:error",
    ]);
  });
});

describe("commits (GR7012) and no task (GR9008)", () => {
  const commit = (subject: string, body = "") => ({ sha: "a".repeat(40), subject, body });

  it("flags commits that name no task or an unknown one, and skips merges", () => {
    const findings = runGuardChecks(
      input({
        commits: [
          commit("fix the thing"),
          commit("fix T-20 again"),
          commit("body names it", "Refs T-20"),
          commit("T-99 something"),
          commit("Merge pull request #4 from x/y"),
        ],
      }),
    );

    expect(findings.map((finding) => finding.code)).toEqual(["GR7012", "GR7012"]);
    expect(findings[1]?.message).toContain("T-99");
  });

  it("reports GR9008 and still runs the task-free rules when there is no task", () => {
    const file = "src/a.tsx";
    const findings = runGuardChecks(
      input({
        scope: null,
        changed: [change(file, "added", [1]), change("anything.ts")],
        texts: { [file]: { base: null, current: 'const a = "ml-4";' } },
      }),
    );

    expect(findings.map((finding) => finding.code)).toEqual(["GR9008", "GR3007"]);
  });
});

describe("helpers", () => {
  it("matches globs", () => {
    expect(matchesGlob("src/app/auth/x.ts", "src/app/auth/**")).toBe(true);
    expect(matchesGlob("a/migrations/b/c.ts", "**/migrations/**")).toBe(true);
    expect(matchesGlob("migrations/c.ts", "**/migrations/**")).toBe(true);
    expect(matchesGlob("src/a.ts", "src/*.ts")).toBe(true);
    expect(matchesGlob("src/x/a.ts", "src/*.ts")).toBe(false);
    expect(matchesGlob("src/app/payments/x.ts", "src/app/payments")).toBe(true);
    expect(matchesGlob("src/app/paymentsX/x.ts", "src/app/payments")).toBe(false);
    expect(matchesGlob("src/a.ts", "src/*.{ts,tsx}")).toBe(true);
    expect(matchesGlob("pnpm-lock.yaml", "pnpm-lock.yaml")).toBe(true);
  });

  it("splits a list on commas outside braces", () => {
    expect(splitList("a, `b/*.{c,d}`, ,e")).toEqual(["a", "b/*.{c,d}", "e"]);
  });

  it("reads a task's scope from its body fields", () => {
    const at = { file: "t.md", line: 1, column: null };
    const task = {
      file: "grimoire/tasks/open/T-012-x.md",
      id: { value: "T-12", at },
      feature: { value: "catalog", at },
      flow: { value: "new-arrivals", at },
      fields: [
        { key: "Files", value: "src/a.ts, src/b/**", at },
        { key: "Features", value: "orders, auth/login", at },
        { key: "Locked", value: "src/t.test.ts", at },
        { key: "Touches", value: "Migrations, public-api", at },
        { key: "Removes", value: "catalog/new-arrivals AC-3, catalog/wishlist case Duplicate", at },
      ],
    } as never;

    expect(readTaskScope(task)).toEqual({
      id: "T-12",
      file: "grimoire/tasks/open/T-012-x.md",
      feature: "catalog",
      flow: "catalog/new-arrivals",
      features: ["catalog", "orders", "auth/login"],
      files: ["src/a.ts", "src/b/**"],
      locked: ["src/t.test.ts"],
      touches: ["migrations", "public-api"],
      removes: [
        {
          feature: "catalog",
          flow: "new-arrivals",
          criterion: "AC-3",
          case: null,
          text: "catalog/new-arrivals AC-3",
        },
        {
          feature: "catalog",
          flow: "wishlist",
          criterion: null,
          case: "duplicate",
          text: "catalog/wishlist case Duplicate",
        },
      ],
    });
  });

  it("finds a task by number", () => {
    const written = {
      ...emptyWritten(),
      tasks: [{ id: { value: "T-12" } }],
    } as unknown as WrittenGrimoire;

    expect(findTask(written, "T-012")?.id.value).toBe("T-12");
    expect(findTask(written, "12")?.id.value).toBe("T-12");
    expect(findTask(written, "13")).toBeNull();
  });

  it("describes a route difference", () => {
    expect(describeRouteDiff(diffRoutes(["GET /a", "GET /b"], ["GET /b", "POST /c"]))).toBe(
      "added POST /c; removed GET /a",
    );
  });
});

/**
 * The drift-control demo: a task asks for one thing, the diff does three
 * others (an unasked file in another module, a deleted proving test, a
 * physical `ml-4` in a catalog file), and the guard catches all three.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GuardReport } from "../src/contracts";
import { GRIMOIRE_IGNORE_RULES } from "../src/paths";
import { openGrimoire } from "../src/workspace";
import { runApproveApi } from "../src/warlock/api-command";
import { runGuard } from "../src/warlock/guard-command";
import { createShopAdapter, shopFacts } from "./fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "./support/copy-fixture";

const copies: FixtureCopy[] = [];

afterEach(() => {
  for (const copy of copies.splice(0)) copy.remove();
});

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

const TASK = (extra: string[] = []): string =>
  [
    "---",
    "id: T-20",
    "type: feature",
    "feature: catalog",
    "flow: new-arrivals",
    "apps: [web-client]",
    "status: in progress",
    "---",
    "",
    "# Refresh the new arrivals list",
    "",
    "- Asked by: the owner, 2026-11-23",
    "- Why: the list must be fresh",
    ...extra,
    "",
  ].join("\n");

/** The shop project as a git repository with the task committed. */
function project(): { copy: FixtureCopy; root: string; first: string } {
  const copy = copyFixture();

  copies.push(copy);
  copy.write(".gitignore", `${GRIMOIRE_IGNORE_RULES.join("\n")}\n`);
  copy.write("grimoire/tasks/open/T-20-refresh-arrivals.md", TASK());
  git(copy.root, "init", "-q", "-b", "main");
  git(copy.root, "config", "user.email", "t@example.com");
  git(copy.root, "config", "user.name", "T");
  git(copy.root, "config", "commit.gpgsign", "false");
  git(copy.root, "add", ".");
  git(copy.root, "commit", "-q", "-m", "start T-20");

  return { copy, root: copy.root, first: git(copy.root, "rev-parse", "HEAD") };
}

/** The demo diff: an unasked file, a deleted proving test, and `ml-4` (when `physical`). */
function demoDiff(copy: FixtureCopy, physical: boolean): void {
  mkdirSync(path.join(copy.root, "src/app/orders/utils"), { recursive: true });
  writeFileSync(path.join(copy.root, "src/app/orders/utils/extra.ts"), "export const extra = 1;\n");
  unlinkSync(path.join(copy.root, "src/app/catalog/tests/new-arrivals.test.ts"));
  writeFileSync(
    path.join(copy.root, "src/app/catalog/controllers/new-arrivals.controller.ts"),
    `${copy.read("src/app/catalog/controllers/new-arrivals.controller.ts")}export const badge = "${physical ? "ml-4" : "ms-4"} flex";\n`,
  );
}

async function guard(
  root: string,
  task: string | undefined,
  options: Record<string, unknown> = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runGuard(
    {
      root,
      adapter: createShopAdapter(),
      io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    },
    task,
    options,
  );

  return { code, out, err };
}

describe("warlock grimoire guard: the demo diff", () => {
  it("catches the unasked file, the deleted proving test and ml-4, and exits 1", async () => {
    const { copy, root } = project();

    demoDiff(copy, true);

    const { code, out } = await guard(root, "T-20");
    const text = out.join("\n");

    expect(code).toBe(1);
    expect(text).toContain("GR7006");
    expect(text).toContain("src/app/orders/utils/extra.ts");
    expect(text).toContain("GR7008");
    expect(text).toContain("GR3007");
    expect(text).toContain("guard: ");
    expect(text).not.toContain("guard: ok");
  });

  it("prints the report as JSON", async () => {
    const { copy, root, first } = project();

    demoDiff(copy, true);

    const { code, out } = await guard(root, "20", { json: true });
    const report = JSON.parse(out.join("\n")) as GuardReport;

    expect(code).toBe(1);
    expect(report.schemaVersion).toBe(1);
    expect(report.task).toBe("T-20");
    expect(report.base).toBe(first);
    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => finding.code).sort()).toEqual([
      "GR3007",
      "GR7006",
      "GR7008",
      "GR7008",
    ]);
    expect(report.changed.map((file) => file.file)).toContain("src/app/orders/utils/extra.ts");
    expect(
      report.findings.every(
        (finding) => finding.subject.task === "T-20" || finding.code === "GR7008",
      ),
    ).toBe(true);
    expect(report.notApproved).toEqual([]);
  });

  it("in hook mode writes to stderr and exits 2", async () => {
    const { copy, root } = project();

    demoDiff(copy, true);

    const { code, out, err } = await guard(root, "T-20", { hook: true, hookInput: "" });

    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain("GR7006");
  });

  it("in hook mode lets the agent stop the second time (stop_hook_active on stdin)", async () => {
    const { copy, root } = project();

    demoDiff(copy, true);

    const again = await guard(root, "T-20", {
      hook: true,
      hookInput: JSON.stringify({ stop_hook_active: true }),
    });

    expect(again.code).toBe(0);
    expect(again.err.join("\n")).toContain("GR7006");
    expect(again.err.join("\n")).toContain("already stopped this agent once");
  });

  it("counts the approved baseline and approved images as in scope", async () => {
    const { copy, root } = project();

    copy.write("grimoire/approved/api.json", "{}\n");
    copy.write("grimoire/screenshots/approved/catalog/new-arrivals/AC-1.png", "png");

    const { out } = await guard(root, "T-20", { json: true });
    const report = JSON.parse(out.join("\n")) as GuardReport;

    expect(report.findings.filter((finding) => finding.code === "GR7006")).toEqual([]);
  });

  it("passes once the task names the file and the removals, and the class is logical", async () => {
    const { copy, root } = project();

    copy.write(
      "grimoire/tasks/open/T-20-refresh-arrivals.md",
      TASK([
        "- Files: src/app/orders/utils/extra.ts",
        "- Removes: catalog/new-arrivals AC-1, catalog/new-arrivals AC-2",
      ]),
    );
    demoDiff(copy, false);

    const { code, out } = await guard(root, "T-20");

    expect(out.join("\n")).toContain("guard: ok");
    expect(code).toBe(0);
  });

  it("a locked test that is edited fails the guard", async () => {
    const { copy, root } = project();

    copy.write(
      "grimoire/tasks/open/T-20-refresh-arrivals.md",
      TASK(["- Locked: src/app/catalog/tests/new-arrivals.test.ts"]),
    );
    git(root, "commit", "-q", "-am", "lock T-20");
    copy.write(
      "src/app/catalog/tests/new-arrivals.test.ts",
      `${copy.read("src/app/catalog/tests/new-arrivals.test.ts")}// edited\n`,
    );

    const { code, out } = await guard(root, "T-20");

    expect(code).toBe(1);
    expect(out.join("\n")).toContain("GR7009");
  });

  it("does not trap an agent that has no task in hook mode, and fails otherwise", async () => {
    const { copy, root } = project();

    demoDiff(copy, true);

    const hook = await guard(root, undefined, { hook: true });

    // T-15 and T-20 are both in progress: there is no single task.
    expect(hook.code).toBe(0);
    expect(hook.err.join("\n")).toContain("GR9008");

    const plain = await guard(root, undefined);

    expect(plain.code).toBe(1);
    expect(plain.out.join("\n")).toContain("GR9008");
  });

  it("checks that every commit names its task", async () => {
    const { copy, root, first } = project();

    copy.write(
      "src/app/catalog/controllers/new-arrivals.controller.ts",
      `${copy.read("src/app/catalog/controllers/new-arrivals.controller.ts")}// tweak\n`,
    );
    git(root, "commit", "-q", "-am", "tweak the list");

    const bad = await guard(root, "T-20", { base: first, commits: `${first}..HEAD` });

    expect(bad.code).toBe(1);
    expect(bad.out.join("\n")).toContain("GR7012");

    copy.write(
      "src/app/catalog/controllers/new-arrivals.controller.ts",
      `${copy.read("src/app/catalog/controllers/new-arrivals.controller.ts")}// again\n`,
    );
    git(root, "commit", "-q", "-am", "tweak the list for T-20");

    const early = await guard(root, "T-20", { base: first, commits: `${first}..HEAD~1` });

    expect(early.out.join("\n")).toContain("GR7012");

    const named = await guard(root, undefined, { base: first, commits: "HEAD~1..HEAD" });

    expect(named.code).toBe(0);
  });

  it("answers GR9009 for a base git does not know", async () => {
    const { root } = project();
    const { code, err } = await guard(root, "T-20", { base: "origin/nowhere" });

    expect(code).toBe(1);
    expect(err.join("\n")).toContain("GR9009");
  });
});

describe("warlock grimoire approve api", () => {
  it("writes the approved routes, and the guard then flags an API change without public-api in Touches", async () => {
    const { copy, root } = project();
    const adapter = createShopAdapter();
    const lines: string[] = [];
    const io = { out: (line: string) => lines.push(line), err: (line: string) => lines.push(line) };

    // The route facts are cached by a build, which `guard` and `approve api` never run.
    await openGrimoire(root, adapter, { routes: "fresh" });

    expect(await runApproveApi({ root, adapter, io }, {})).toBe(0);

    const approved = JSON.parse(copy.read("grimoire/approved/api.json")) as {
      schemaVersion: number;
      routes: string[];
    };

    expect(approved.schemaVersion).toBe(1);
    expect(approved.routes).toEqual([...approved.routes].sort());
    expect(approved.routes.length).toBe(
      new Set(
        shopFacts.routes
          ?.filter((route) => !route.isPage)
          .map((route) => `${route.method} ${route.path}`),
      ).size,
    );

    const extra = { ...approved, routes: [...approved.routes, "GET /gone"] };

    copy.write("grimoire/approved/api.json", JSON.stringify(extra));
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "approve api T-20");

    const { out } = await guard(root, "T-20");

    expect(out.join("\n")).toContain("GR7011");
    expect(out.join("\n")).toContain("removed GET /gone");
  });
});

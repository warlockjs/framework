/**
 * `warlock grimoire build|check|release` and `warlock scry` over copies of
 * the shop fixture with the counting fake adapter, the commands'
 * registration (MCP tools, `warlock explain` codes, boot decisions) and the
 * MCP tools.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import {
  explainersOf,
  mcpToolsOf,
  type WarlockMcpContext,
  type WarlockMcpTool,
} from "@warlock.js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookAdapter } from "../src/contracts/adapter";
import type { ScryError } from "../src/contracts/scry";
import { GRIMOIRE_MCP_TOOL_NAMES, createGrimoireMcpTools } from "../src/warlock/mcp-tools";
import {
  needsBoot,
  runBuild,
  runCheck,
  runRelease,
  runScry,
  type CommandIO,
} from "../src/warlock/actions";
import { registerGrimoireCommands } from "../src/warlock";
import { DERIVED_PATH } from "../src/workspace/derived";
import { createShopAdapter } from "./fixtures/shop-facts";
import { copyFixture, type FixtureCopy } from "./support/copy-fixture";

type Captured = CommandIO & { stdout: string[]; stderr: string[] };

function capture(): Captured {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    out: (line) => void stdout.push(line),
    err: (line) => void stderr.push(line),
  };
}

/** Every file of a project with its size and modified time, to see that a command wrote nothing. */
function snapshotOfFiles(root: string): string[] {
  const lines: string[] = [];
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const absolute = path.join(folder, entry.name);

      if (entry.isDirectory()) walk(absolute);
      else {
        const info = statSync(absolute);

        lines.push(`${path.relative(root, absolute)} ${info.size} ${info.mtimeMs}`);
      }
    }
  };

  walk(root);

  return lines.sort();
}

const copies: FixtureCopy[] = [];

function fixture(): FixtureCopy {
  const copy = copyFixture();

  copies.push(copy);

  return copy;
}

afterEach(() => {
  for (const copy of copies.splice(0)) copy.remove();
});

describe("warlock grimoire build", () => {
  it("builds the book with fresh routes, then reports a no-change run", async () => {
    const copy = fixture();
    const adapter = createShopAdapter();
    const io = capture();

    expect(await runBuild({ root: copy.root, adapter, io })).toBe(0);
    expect(io.stdout[0]).toMatch(/^book {6}35 files \(\d+ written, 0 removed\), routes fresh$/);
    expect(io.stdout[1]).toBe(
      "features  3 (bookmaps written: 9)   tasks  1 open, 1 waiting, 1 done",
    );
    expect(adapter.calls.routes).toBe(1);

    const again = capture();

    expect(await runBuild({ root: copy.root, adapter, io: again })).toBe(0);
    expect(again.stdout[0]).toBe("book      up to date");
    expect(adapter.calls.routes).toBe(1);
  });

  it("prints JSON with --json", async () => {
    const copy = fixture();
    const io = capture();

    await runBuild({ root: copy.root, adapter: createShopAdapter(), io }, { json: true });

    expect(JSON.parse(io.stdout.join("\n"))).toMatchObject({
      rebuilt: true,
      routes: "fresh",
      removed: [],
      site: null,
    });
  });

  it("falls back to cached routes with a GR8002 warning when the app does not boot", async () => {
    const copy = fixture();
    const adapter: BookAdapter = {
      ...createShopAdapter(),
      routes: async () => {
        throw new Error("src/app/orders/routes.ts: Cannot find module './missing'");
      },
    };
    const io = capture();

    expect(await runBuild({ root: copy.root, adapter, io })).toBe(0);
    expect(io.stdout[0]).toMatch(/routes missing$/);
    expect(io.stderr[0]).toMatch(/^GR8002 {2}.*Cannot find module/);
    expect(io.stderr[1]).toMatch(/^ {2}fix: Run `warlock doctor`/);
  });

  it("writes the static site with --site and --out", async () => {
    const copy = fixture();
    const io = capture();

    expect(
      await runBuild(
        { root: copy.root, adapter: createShopAdapter(), io },
        { site: true, out: "public/grimoire" },
      ),
    ).toBe(0);
    expect(io.stdout.at(-2)).toBe("site      public/grimoire/index.html");
    expect(existsSync(path.join(copy.root, "public", "grimoire", "index.html"))).toBe(true);
  });

  it("refuses an --out outside the project or the project root itself, before writing", async () => {
    const copy = fixture();

    for (const out of ["", ".", "..", "../elsewhere", path.join(copy.root, "..", "elsewhere")]) {
      const io = capture();
      const adapter = createShopAdapter();

      expect(await runBuild({ root: copy.root, adapter, io }, { site: true, out })).toBe(1);
      expect(io.stderr[0]).toMatch(/^GR9006 {2}--out .* is not a folder inside the project/);
      expect(adapter.calls.files).toBe(0);
    }

    expect(existsSync(path.join(copy.root, "index.html"))).toBe(false);
    expect(existsSync(path.join(copy.root, "..", "elsewhere"))).toBe(false);
  });
});

describe("warlock grimoire check", () => {
  it("prints the report and exits 0 when only expected errors remain", async () => {
    const copy = fixture();
    const io = capture();

    expect(await runCheck({ root: copy.root, adapter: createShopAdapter(), io })).toBe(0);
    expect(io.stdout.at(-3)).toBe("0 errors, 9 warnings, 9 expected  (routes: fresh)");
  });

  it("exits 1 on an unexpected error and prints JSON with --json", async () => {
    const copy = fixture();

    copy.replace(
      "grimoire/features/catalog/flows/new-arrivals.md",
      "GET /api/products/new-arrivals",
      "GET /api/products/newest",
    );

    const io = capture();

    expect(
      await runCheck({ root: copy.root, adapter: createShopAdapter(), io }, { json: true }),
    ).toBe(1);

    const report = JSON.parse(io.stdout.join("\n"));

    expect(report.ok).toBe(false);
    expect(report.findings[0]).toMatchObject({ code: "GR2001", expected: false });
  });

  it("goes on with cached routes when the app does not boot: a GR8002 warning, exit 0", async () => {
    const copy = fixture();

    await runBuild({ root: copy.root, adapter: createShopAdapter(), io: capture() });
    copy.replace("src/app/orders/routes.ts", "\n", "\n// changed\n");

    const adapter: BookAdapter = {
      ...createShopAdapter(),
      routes: async () => {
        throw new Error("the app did not boot (src/app/orders/routes.ts: boom)");
      },
    };
    const io = capture();

    expect(await runCheck({ root: copy.root, adapter, io })).toBe(0);
    expect(io.stdout).toContain(
      "-  GR8002  warning  route facts could not be read: the app did not boot (src/app/orders/routes.ts: boom)",
    );
    expect(io.stdout.at(-3)).toBe("0 errors, 11 warnings, 9 expected  (routes: stale)");
  });
});

describe("warlock grimoire release", () => {
  it("collects the stamped entries and notes the unreleased ones", async () => {
    const copy = fixture();
    const io = capture();

    expect(await runRelease({ root: copy.root, adapter: createShopAdapter(), io }, "1.0.0")).toBe(
      0,
    );
    expect(io.stdout[0]).toMatch(
      /^grimoire\/releases\/1\.0\.0\.md: 4 entries collected \(auth 1\.0 added, catalog 2\.0 added, catalog 1\.0 added, orders 1\.0 added\), file unchanged$/,
    );
    expect(io.stdout[1]).toMatch(
      /^note: 1 entry is still unreleased: catalog 2\.1\. To ship them in 1\.0\.0, move them under "## 1\.0\.0 \(2026-10-01\)"/,
    );
  });

  it("exits 1 with GR9005 when the release file is missing, and GR1024 for broken markers", async () => {
    const copy = fixture();
    const io = capture();

    expect(await runRelease({ root: copy.root, adapter: createShopAdapter(), io }, "9.9.9")).toBe(
      1,
    );
    expect(io.stderr[0]).toMatch(/^GR9005 {2}/);
    expect(io.stderr[1]).toMatch(/^ {2}fix: Write `grimoire\/releases\/<release>\.md`/);

    copy.replace("grimoire/releases/1.0.0.md", "<!-- grimoire:collected:end -->", "");

    const broken = capture();

    expect(
      await runRelease({ root: copy.root, adapter: createShopAdapter(), io: broken }, "1.0.0"),
    ).toBe(1);
    expect(broken.stderr[0]).toMatch(
      /^GR1024 {2}grimoire\/releases\/1\.0\.0\.md has broken collected-list markers/,
    );
  });

  it("refuses a missing release name with GR9006", async () => {
    const io = capture();

    expect(
      await runRelease({ root: fixture().root, adapter: createShopAdapter(), io }, undefined),
    ).toBe(1);
    expect(io.stderr[0]).toMatch(/^GR9006 {2}Pass the release name/);
  });
});

describe("warlock scry", () => {
  it("answers each form in text, and JSON with --json", async () => {
    const copy = fixture();
    const adapter = createShopAdapter();
    const io = capture();

    await runBuild({ root: copy.root, adapter, io: capture() });

    expect(
      await runScry({ root: copy.root, adapter, io }, [
        "src/app/catalog/services/new-arrivals.service.ts",
      ]),
    ).toBe(0);
    expect(io.stdout[0]).toBe(
      "src/app/catalog/services/new-arrivals.service.ts  service  10 lines",
    );

    const json = capture();

    expect(
      await runScry({ root: copy.root, adapter, io: json }, [], {
        flow: "catalog/new-arrivals",
        json: true,
      }),
    ).toBe(0);
    expect(JSON.parse(json.stdout.join("\n"))).toMatchObject({ type: "flow", routes: "fresh" });
  });

  it("prints a failure as a JSON error on stdout under --json, and exits 1", async () => {
    const copy = fixture();
    const adapter = createShopAdapter();
    const io = capture();

    await runBuild({ root: copy.root, adapter, io: capture() });

    expect(
      await runScry({ root: copy.root, adapter, io }, [], {
        route: "DELETE /api/nowhere",
        json: true,
      }),
    ).toBe(1);
    expect(io.stderr).toEqual([]);

    const error = JSON.parse(io.stdout.join("\n"));

    expect(error).toMatchObject({ type: "error", code: "GR9002" });
    expect(error.message).toMatch(/^No route matches DELETE \/api\/nowhere/);
    expect(error.fix).not.toBe("");
  });

  it("exits 1 with the code, the message and the fix", async () => {
    const io = capture();
    const copy = fixture();
    const adapter = createShopAdapter();

    await runBuild({ root: copy.root, adapter, io: capture() });

    expect(await runScry({ root: copy.root, adapter, io }, [], { feature: "billing" })).toBe(1);
    expect(io.stderr[0]).toMatch(/^GR9003 {2}No feature has the id "billing"/);
    expect(io.stderr[1]).toMatch(/^ {2}fix: /);
  });

  it("never calls routes, named or files, and never writes", async () => {
    const copy = fixture();
    const adapter = createShopAdapter();

    await runBuild({ root: copy.root, adapter, io: capture() });

    const calls = { ...adapter.calls };
    const before = snapshotOfFiles(copy.root);

    for (const [args, options] of [
      [["src/app/orders/routes.ts"], {}],
      [[], { impact: "src/app/catalog/models/product.model.ts" }],
      [[], { feature: "catalog" }],
      [[], { flow: "orders/place-order" }],
      [[], { search: "order" }],
      [[], { route: "POST /api/orders" }],
    ] as const) {
      expect(await runScry({ root: copy.root, adapter, io: capture() }, args, options)).toBe(0);
    }

    // The change check reads the source roots (a cheap list); nothing else is asked of the adapter.
    expect({ ...adapter.calls, sourceRoots: 0 }).toEqual({ ...calls, sourceRoots: 0 });
    expect(snapshotOfFiles(copy.root)).toEqual(before);
  });

  it("notes a stale book, answers from the stored one and writes nothing", async () => {
    const copy = fixture();
    const adapter = createShopAdapter();

    await runBuild({ root: copy.root, adapter, io: capture() });
    copy.replace("src/app/orders/routes.ts", "\n", "\n// changed\n");

    const calls = { ...adapter.calls };
    const before = snapshotOfFiles(copy.root);
    const io = capture();

    expect(await runScry({ root: copy.root, adapter, io }, ["src/app/orders/routes.ts"])).toBe(0);
    expect(io.stdout.join("\n")).toContain(
      "note      book is stale (1 file changed); run warlock grimoire build",
    );
    expect(adapter.calls.files).toBe(calls.files);
    expect(adapter.calls.routes).toBe(calls.routes);

    const json = capture();

    await runScry({ root: copy.root, adapter, io: json }, ["src/app/orders/routes.ts"], {
      json: true,
    });
    expect(JSON.parse(json.stdout.join("\n")).notes).toContain(
      "book is stale (1 file changed); run warlock grimoire build",
    );
    expect(snapshotOfFiles(copy.root).filter((line) => !line.startsWith("src/"))).toEqual(
      before.filter((line) => !line.startsWith("src/")),
    );
  });

  it("fails with GR9007 when the book was never built, and builds nothing", async () => {
    const copy = fixture();
    const adapter = createShopAdapter();
    const io = capture();

    expect(await runScry({ root: copy.root, adapter, io }, ["src/app/orders/routes.ts"])).toBe(1);
    expect(io.stderr[0]).toMatch(
      /^GR9007 {2}The book has not been built yet\. Run warlock grimoire build/,
    );
    expect(adapter.calls.files).toBe(0);
    expect(existsSync(path.join(copy.root, "grimoire", "book"))).toBe(false);
  });

  it("fails with GR9007 when the derived data is missing", async () => {
    const copy = fixture();
    const adapter = createShopAdapter();

    await runBuild({ root: copy.root, adapter, io: capture() });
    rmSync(path.join(copy.root, ...DERIVED_PATH.split("/")));

    const io = capture();

    expect(await runScry({ root: copy.root, adapter, io }, ["src/app/orders/routes.ts"])).toBe(1);
    expect(io.stderr[0]).toMatch(/^GR9007 {2}The book's derived data is missing/);
  });

  it("answers a route question from the stored facts, and says so when there are none", async () => {
    const copy = fixture();
    const adapter = createShopAdapter();

    await runBuild({ root: copy.root, adapter, io: capture() });
    expect(
      await runScry({ root: copy.root, adapter, io: capture() }, [], { route: "POST /api/orders" }),
    ).toBe(0);
  });
});

describe("registerGrimoireCommands", () => {
  it("returns the grimoire and scry commands with the MCP tools and the code explainer attached", () => {
    const [grimoire, scry, ...rest] = registerGrimoireCommands();

    expect(rest).toEqual([]);
    expect(grimoire?.name).toBe("grimoire <action> [release]");
    expect(scry?.name).toBe("scry [file]");
    expect(mcpToolsOf(grimoire)).toHaveLength(1);

    const [explain] = explainersOf(grimoire);

    expect(explain?.("gr2001")).toMatchObject({
      code: "GR2001",
      area: "links",
      docs: "https://warlock.js.org/v/latest/grimoire/guides/04-check/#gr2001",
    });
    expect(explain?.("WL3001")).toBeUndefined();
  });

  it("decides the boot before build and check: only when route facts are not fresh", async () => {
    const copy = fixture();
    const adapter = createShopAdapter();

    expect(await needsBoot(copy.root, false)).toBe(true);
    expect(adapter.calls.routes).toBe(0);

    await runBuild({ root: copy.root, adapter, io: capture() });
    expect(await needsBoot(copy.root, false)).toBe(false);
    expect(await needsBoot(copy.root, true)).toBe(true);

    copy.replace("src/app/orders/routes.ts", "\n", "\n// changed\n");
    expect(await needsBoot(copy.root, false)).toBe(true);

    await runBuild({ root: copy.root, adapter, io: capture() });
    expect(await needsBoot(copy.root, false)).toBe(false);

    copy.write("src/app/catalog/routes.tsx", "export {};\n");
    expect(await needsBoot(copy.root, false)).toBe(true);
  });

  it("loads only src/config/web.ts for a multi-site app, and never boots for a route question", async () => {
    const copy = fixture();
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(copy.root);

    try {
      const [grimoire, scry] = registerGrimoireCommands();

      await scry?.commandPreAction?.({ args: ["src/app/orders/routes.ts"], options: {} });
      expect(scry?.commandPreload).toEqual({ config: ["web"] });

      // A route question never boots the app: scry only reads the stored book.
      await scry?.commandPreAction?.({ args: [], options: { route: "POST /api/orders" } });
      expect(scry?.commandPreload).toEqual({ config: ["web"] });

      await grimoire?.commandPreAction?.({ args: ["check"], options: {} });
      expect(grimoire?.commandPreload).toMatchObject({ bootstrap: true });
    } finally {
      cwd.mockRestore();
    }
  });

  it("sets no preload for release and scry file questions", async () => {
    const [grimoire, scry] = registerGrimoireCommands();

    await grimoire?.commandPreAction?.({ args: ["release", "1.0.0"], options: {} });
    expect(grimoire?.commandPreload).toBeUndefined();

    await scry?.commandPreAction?.({ args: ["src/app/a.ts"], options: {} });
    expect(scry?.commandPreload).toBeUndefined();
  });
});

describe("Grimoire MCP tools", () => {
  function tools(root: string, adapter: BookAdapter): Map<string, WarlockMcpTool> {
    const context = { cwd: root, inspect: async () => ({}) } as unknown as Pick<
      WarlockMcpContext,
      "cwd" | "inspect"
    >;

    return new Map(
      createGrimoireMcpTools(context, {}, async () => adapter).map((tool) => [tool.name, tool]),
    );
  }

  /** The `ScryError` a scry tool's rejection carries as its message. */
  async function scryErrorFrom(call: Promise<unknown> | undefined): Promise<ScryError> {
    try {
      await call;
    } catch (error) {
      return JSON.parse((error as Error).message) as ScryError;
    }

    throw new Error("the tool did not fail");
  }

  it("lists the tools in order; only grimoire_release writes", () => {
    const list = [...tools("/project", createShopAdapter()).values()];

    expect(list.map((tool) => tool.name)).toEqual([...GRIMOIRE_MCP_TOOL_NAMES]);
    expect(list.filter((tool) => tool.writes).map((tool) => tool.name)).toEqual([
      "grimoire_release",
    ]);
  });

  it("answers with the JSON results and never boots for read tools", async () => {
    const copy = fixture();
    const adapter = createShopAdapter();
    const byName = tools(copy.root, adapter);
    const run = (name: string, input: Record<string, unknown>) => byName.get(name)?.run(input);

    expect(await run("grimoire_build", {})).toMatchObject({ routes: "fresh" });
    expect(adapter.calls.routes).toBe(1);
    expect(await run("grimoire_file", { file: "src/app/orders/routes.ts" })).toMatchObject({
      type: "file",
    });
    expect(
      await run("grimoire_impact", { file: "src/app/catalog/models/product.model.ts" }),
    ).toMatchObject({ type: "impact" });
    expect(await run("grimoire_feature", { feature: "orders" })).toMatchObject({ type: "feature" });
    expect(await run("grimoire_flow", { flow: "catalog/new-arrivals" })).toMatchObject({
      type: "flow",
    });
    const compact = (await run("grimoire_flow", { flow: "catalog/new-arrivals" })) as {
      bookmap: { steps: { counts: { reachable: number }; files?: unknown }[] };
    };

    expect(compact.bookmap.steps[0]?.counts.reachable).toBeGreaterThan(0);
    expect(compact.bookmap.steps[0]).not.toHaveProperty("files");
    expect(
      await run("grimoire_flow", { flow: "catalog/new-arrivals", files: "reachable", step: 1 }),
    ).toMatchObject({ set: "reachable", index: 1 });
    expect(
      await scryErrorFrom(
        byName
          .get("grimoire_flow")
          ?.run({ flow: "catalog/new-arrivals", files: "reachable", step: 99 }),
      ),
    ).toMatchObject({
      type: "error",
      code: "GR9006",
      message: expect.stringMatching(/^Pass step/),
    });
    expect(await run("grimoire_search", { text: "order", limit: 2 })).toMatchObject({
      type: "search",
    });
    expect(await run("grimoire_check", {})).toMatchObject({ schemaVersion: 1, routes: "fresh" });
    expect(adapter.calls.routes).toBe(1);
    expect(await run("grimoire_route", { method: "post", path: "/api/orders" })).toMatchObject({
      type: "route",
    });
    expect(await run("grimoire_explain", { code: "GR9001" })).toMatchObject({
      code: "GR9001",
      severity: "error",
    });
    expect(await run("grimoire_release", { release: "1.0.0" })).toMatchObject({
      file: "grimoire/releases/1.0.0.md",
    });
  });

  it("turns scry errors into tool errors whose text is the ScryError JSON", async () => {
    const copy = fixture();
    const adapter = createShopAdapter();
    const byName = tools(copy.root, adapter);

    expect(
      await scryErrorFrom(byName.get("grimoire_file")?.run({ file: "src/app/orders/routes.ts" })),
    ).toMatchObject({
      type: "error",
      code: "GR9007",
      message: expect.stringMatching(/^The book has not been built yet\./),
    });
    await byName.get("grimoire_build")?.run({});

    const flow = await scryErrorFrom(byName.get("grimoire_flow")?.run({ flow: "catalog/returns" }));

    expect(flow).toMatchObject({
      type: "error",
      code: "GR9004",
      message: expect.stringMatching(/^No flow catalog\/returns\./),
    });
    expect(flow.fix).not.toBe("");
    expect(
      await scryErrorFrom(byName.get("grimoire_search")?.run({ text: "order", limit: 0 })),
    ).toMatchObject({
      code: "GR9006",
      message: expect.stringMatching(/^--limit must be a whole number above 0/),
    });
    expect(
      await scryErrorFrom(byName.get("grimoire_route")?.run({ method: "DELETE", path: "/nope" })),
    ).toMatchObject({ code: "GR9002" });
    await expect(byName.get("grimoire_explain")?.run({ code: "GR0000" })).rejects.toThrow(
      /Unknown Grimoire code/,
    );
  });

  it("reports a stored book that is behind the files in grimoire_check", async () => {
    const copy = fixture();
    const byName = tools(copy.root, createShopAdapter());

    await byName.get("grimoire_build")?.run({});
    expect(await byName.get("grimoire_check")?.run({})).not.toHaveProperty("note");

    copy.replace("src/app/orders/routes.ts", "\n", "\n// changed\n");
    expect(await byName.get("grimoire_check")?.run({})).toMatchObject({
      note: "book is stale (1 file changed); run warlock grimoire build",
    });
  });
});

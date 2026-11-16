import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type {
  TaskStatus,
  WrittenFeature,
  WrittenGrimoire,
  WrittenTask,
} from "../contracts/written";
import { checkTasks } from "./index";

const at = (file: string, line = 1) => ({ file, line, column: null });
const located = <T>(value: T, file: string, line = 1) => ({ value, at: at(file, line) });

function task(id: string, over: Partial<WrittenTask> = {}): WrittenTask {
  const file = `grimoire/tasks/open/${id}-x.md`;

  return {
    file,
    folder: "open",
    month: null,
    id: located(id, file),
    type: located("feature", file),
    feature: located("catalog", file, 3),
    flow: located("wishlist", file, 4),
    apps: [],
    status: located<TaskStatus>("open", file, 5),
    shipped: null,
    heading: null,
    fields: [],
    decisionNeeded: null,
    ...over,
  };
}

const catalog: WrittenFeature = {
  id: "catalog",
  dir: "grimoire/features/catalog",
  readme: null,
  changelog: {
    file: "grimoire/features/catalog/CHANGELOG.md",
    sections: [],
    entries: [
      {
        feature: "catalog",
        version: located("2.1", "c.md"),
        word: "fixed",
        flow: null,
        criteria: [],
        text: "x",
        release: null,
        date: null,
        at: at("c.md"),
      },
    ],
  },
  flows: [
    {
      file: "f.md",
      feature: "catalog",
      id: located("wishlist", "f.md"),
      ref: "catalog/wishlist",
    } as unknown as WrittenFeature["flows"][number],
  ],
  versions: [],
};

describe("checkTasks", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function run(tasks: WrittenTask[], root = "/nowhere") {
    const written = {
      root,
      exists: true,
      features: [catalog],
      apps: [],
      tasks,
      releases: [],
      hash: "",
    } as WrittenGrimoire;

    return checkTasks({ written, root } as unknown as GrimoireSnapshot);
  }

  const codes = (tasks: WrittenTask[], root?: string) => run(tasks, root).map((item) => item.code);

  it("passes a task that names an existing feature and flow", () => {
    expect(codes([task("T-1")])).toEqual([]);
  });

  it("GR7001: unknown feature", () => {
    const found = run([task("T-1", { feature: located("ghost", "t.md", 3), flow: null })]);

    expect(found.map((item) => item.code)).toEqual(["GR7001"]);
    expect(found[0]?.subject.task).toBe("T-1");
  });

  it("GR7002: unknown flow, a full reference, and a flow with no feature", () => {
    expect(codes([task("T-1", { flow: located("nope", "t.md", 4) })])).toEqual(["GR7002"]);
    expect(codes([task("T-2", { flow: located("catalog/nope", "t.md", 4) })])).toEqual(["GR7002"]);
    expect(codes([task("T-3", { feature: null, flow: located("wishlist", "t.md", 4) })])).toEqual([
      "GR7002",
    ]);
    expect(
      codes([task("T-4", { feature: null, flow: located("catalog/wishlist", "t.md", 4) })]),
    ).toEqual([]);
  });

  it("GR7003: a done task needs status done and shipped; an open task cannot be done", () => {
    const done = { folder: "done" as const, month: "2026-11" };

    expect(codes([task("T-1", done)])).toEqual(["GR7003"]);
    expect(codes([task("T-2", { ...done, status: located<TaskStatus>("done", "t.md") })])).toEqual([
      "GR7003",
    ]);
    expect(
      codes([
        task("T-3", {
          ...done,
          status: located<TaskStatus>("done", "t.md"),
          shipped: located({ feature: "catalog", version: "2.1" }, "t.md"),
        }),
      ]),
    ).toEqual([]);
    expect(codes([task("T-4", { status: located<TaskStatus>("done", "t.md") })])).toEqual([
      "GR7003",
    ]);
  });

  it("GR7004: shipped version not in the changelog", () => {
    const done = {
      folder: "done" as const,
      month: "2026-11",
      status: located<TaskStatus>("done", "t.md"),
    };

    expect(
      codes([
        task("T-1", { ...done, shipped: located({ feature: "catalog", version: "9.9" }, "t.md") }),
      ]),
    ).toEqual(["GR7004"]);
  });

  it("GR7005: a brief that does not exist, and one that does", () => {
    const root = mkdtempSync(path.join(tmpdir(), "grimoire-tasks-"));

    roots.push(root);
    mkdirSync(path.join(root, "grimoire/features/catalog/versions"), { recursive: true });
    writeFileSync(path.join(root, "grimoire/features/catalog/versions/v3.md"), "# v3\n");

    const brief = (value: string) => ({ fields: [{ key: "Brief", value, at: at("t.md", 7) }] });

    expect(codes([task("T-1", brief("features/catalog/versions/v4.md"))], root)).toEqual([
      "GR7005",
    ]);
    expect(codes([task("T-2", brief("features/catalog/versions/v3.md"))], root)).toEqual([]);
  });
});

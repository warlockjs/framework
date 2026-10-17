import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InspectReport } from "../inspect/inspect-report.types";
import { AGENTS_MD_END, AGENTS_MD_START } from "./agents-md-markers";
import { createAgentsMdRefresher } from "./agents-md-refresher";
import { writeAgentsMd } from "./write-agents-md";

function report(name: string): InspectReport {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: {
      name,
      version: null,
      root: "/",
      node: "v22.15.0",
      environment: "development",
      runtimeStrategy: "development",
    },
    sections: ["routes"],
    routes: [],
    components: { schemas: {} },
    warnings: [],
  };
}

const directories: string[] = [];

function project(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "warlock-agents-md-write-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("writeAgentsMd", () => {
  it("creates, then reports unchanged, then updates only the generated section", () => {
    const cwd = project();
    const file = path.join(cwd, "AGENTS.md");

    expect(writeAgentsMd({ cwd, report: report("one"), skills: [] }).status).toBe("created");
    expect(writeAgentsMd({ cwd, report: report("one"), skills: [] }).status).toBe("unchanged");

    const hand = readFileSync(file, "utf8").replace(
      AGENTS_MD_START,
      `# Hand notes\n\n${AGENTS_MD_START}`,
    );
    writeFileSync(file, `${hand}\nAfter the section.\n`);

    expect(writeAgentsMd({ cwd, report: report("two"), skills: [] }).status).toBe("updated");

    const content = readFileSync(file, "utf8");

    expect(content.startsWith(`# Hand notes\n\n${AGENTS_MD_START}\n`)).toBe(true);
    expect(content.endsWith(`${AGENTS_MD_END}\n\nAfter the section.\n`)).toBe(true);
    expect(content).toContain("## two — generated facts");
    expect(content).not.toContain("## one");
  });

  it("skips a missing file when create is false", () => {
    const cwd = project();

    expect(writeAgentsMd({ cwd, report: report("x"), create: false, skills: [] }).status).toBe(
      "skipped",
    );
    expect(existsSync(path.join(cwd, "AGENTS.md"))).toBe(false);
  });

  it("writes nothing when the markers are malformed", () => {
    const cwd = project();
    const file = path.join(cwd, "AGENTS.md");
    const original = `# Notes\n${AGENTS_MD_START}\nno end marker\n`;

    writeFileSync(file, original);

    expect(() => writeAgentsMd({ cwd, report: report("x"), skills: [] })).toThrow(
      /expected exactly one/,
    );
    expect(readFileSync(file, "utf8")).toBe(original);
  });
});

describe("createAgentsMdRefresher", () => {
  it("collapses a burst of schedule() calls into one refresh", async () => {
    vi.useFakeTimers();

    const cwd = project();
    const collect = vi.fn(async () => report("burst"));
    const onWrite = vi.fn();
    const refresher = createAgentsMdRefresher({ cwd, collect, debounceMs: 100, onWrite });

    refresher.schedule();
    await vi.advanceTimersByTimeAsync(50);
    refresher.schedule();
    refresher.schedule();
    await vi.advanceTimersByTimeAsync(99);

    expect(collect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await refresher.flush();

    // The timer's refresh, then flush's own run.
    expect(collect).toHaveBeenCalledTimes(2);
    expect(onWrite.mock.calls[0]?.[0]).toMatchObject({ status: "created" });
    expect(onWrite.mock.calls[1]?.[0]).toMatchObject({ status: "unchanged" });
  });

  it("reports errors to onError and never throws out of the timer", async () => {
    vi.useFakeTimers();

    const onError = vi.fn();
    const refresher = createAgentsMdRefresher({
      cwd: project(),
      collect: async () => {
        throw new Error("boot failed");
      },
      debounceMs: 10,
      onError,
    });

    refresher.schedule();
    await vi.advanceTimersByTimeAsync(10);
    await refresher.flush();

    expect(onError).toHaveBeenCalledTimes(2);
    expect(String(onError.mock.calls[0]?.[0])).toContain("boot failed");
  });

  it("does nothing after dispose()", async () => {
    vi.useFakeTimers();

    const collect = vi.fn(async () => report("x"));
    const refresher = createAgentsMdRefresher({ cwd: project(), collect, debounceMs: 10 });

    refresher.schedule();
    refresher.dispose();
    refresher.schedule();
    await vi.advanceTimersByTimeAsync(50);

    expect(collect).not.toHaveBeenCalled();
  });
});

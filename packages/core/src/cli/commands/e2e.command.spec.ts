import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ runE2E: vi.fn(), loadE2ESpec: vi.fn(), glob: vi.fn() }));
vi.mock("../../e2e/run-e2e", () => ({ runE2E: mock.runE2E }));
vi.mock("./load-e2e-spec", () => ({ loadE2ESpec: mock.loadE2ESpec }));
vi.mock("glob", () => ({ glob: mock.glob }));
import { e2eCommand, e2eCommandAction, readE2EOptions } from "./e2e.command";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
describe("warlock e2e", () => {
  it("registers without app bootstrap and exposes browser/evidence/fake-PATH options", async () => {
    const registry = await readFile(
      new URL("../framework-cli-commands.ts", import.meta.url),
      "utf8",
    );
    expect(registry).toContain("  e2eCommand,");
    expect(e2eCommand.commandPreload).toBeUndefined();
    expect(e2eCommand.commandOptions.map(({ name }) => name)).toEqual(["browser", "out", "path"]);
    expect(
      readE2EOptions({
        args: [],
        options: { browser: "/owned/chrome", out: "results", path: "fakes,engines" },
      }),
    ).toEqual({
      browser: "/owned/chrome",
      outputDirectory: "results",
      path: [resolve("fakes"), resolve("engines")],
    });
  });

  it("rejects empty discovery instead of silently succeeding", async () => {
    mock.glob.mockResolvedValue([]);
    await expect(e2eCommandAction({ args: [], options: {} })).rejects.toThrow(
      "No browser e2e specs found",
    );
  });

  it("runs specs sequentially, removes their compiled modules and reports failures", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.glob.mockResolvedValue(["/specs/b.e2e.ts", "/specs/a.e2e.ts", "/specs/a.e2e.ts"]);
    const disposed: string[] = [];
    mock.loadE2ESpec.mockImplementation(async (file: string) => ({
      spec: { app: {}, file },
      dispose: async () => {
        disposed.push(file);
      },
    }));
    mock.runE2E
      .mockRejectedValueOnce(new Error("deliberate failure"))
      .mockResolvedValueOnce({ evidenceFile: "/evidence/b.json" });
    await expect(e2eCommandAction({ args: ["/specs/*.e2e.ts"], options: {} })).rejects.toThrow(
      "1 browser e2e spec(s) failed",
    );
    expect(disposed).toEqual(["/specs/a.e2e.ts", "/specs/b.e2e.ts"]);
    expect(mock.runE2E).toHaveBeenCalledTimes(2);
  });
});

// Keep the loader's TypeScript behavior covered independently from CLI mocks.
it("compiles a TypeScript spec and removes its temporary ESM entry", async () => {
  const actual = await vi.importActual<typeof import("./load-e2e-spec")>("./load-e2e-spec");
  const root = await mkdtemp(join(tmpdir(), "warlock-spec-loader-"));
  let loaded: Awaited<ReturnType<typeof actual.loadE2ESpec>> | undefined;
  try {
    const file = join(root, "minimal.e2e.ts");
    await writeFile(
      file,
      "const answer: number = 42; export default { app: {}, run: async () => {}, answer };",
    );
    loaded = await actual.loadE2ESpec(file);
    expect(loaded.spec).toMatchObject({ answer: 42 });
  } finally {
    await loaded?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

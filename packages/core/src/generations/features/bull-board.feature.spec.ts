import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let configText = "";
let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } =
  {};

vi.mock("@warlock.js/fs", () => ({
  fileExistsAsync: vi.fn(async () => true),
  getFileAsync: vi.fn(async () => configText),
  getJsonFileAsync: vi.fn(async () => packageJson),
  putFileAsync: vi.fn(async (_path: string, content: string) => {
    configText = content;
  }),
}));

import { bullBoardFeature } from "./bull-board.feature";

const queueConfigStub = [
  "const queueConfig: QueueConfig = {",
  "  connection: { host: 'localhost', port: 6379 },",
  "};",
  "",
  "export default queueConfig;",
  "",
].join("\n");

describe("add bull-board", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.exitCode = undefined;
    configText = queueConfigStub;
    packageJson = { dependencies: { "@warlock.js/queue": "5.13.0" } };
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.exitCode = undefined;
  });

  it("declares both bull-board packages as dependencies", () => {
    expect(bullBoardFeature.dependencies).toEqual({
      "@bull-board/api": "^9.10.1",
      "@bull-board/fastify": "^9.10.1",
    });
  });

  it("adds the dashboard block to src/config/queue.ts when queue is installed", async () => {
    await bullBoardFeature.onExecuting?.({} as never);

    expect(process.exitCode).toBeUndefined();
    expect(configText).toContain(
      '  dashboard: { enabled: true, path: "/admin/queues", middleware: [] },\n};',
    );
  });

  it("is idempotent on a second run", async () => {
    await bullBoardFeature.onExecuting?.({} as never);
    const afterFirstRun = configText;

    await bullBoardFeature.onExecuting?.({} as never);

    expect(configText).toBe(afterFirstRun);
  });

  it("fails with a clear message instead of writing anything when @warlock.js/queue is missing", async () => {
    packageJson = {};

    await bullBoardFeature.onExecuting?.({} as never);

    expect(process.exitCode).toBe(1);
    expect(configText).toBe(queueConfigStub);
    expect(
      logSpy.mock.calls.some((call: unknown[]) => String(call[0]).includes("warlock add queue")),
    ).toBe(true);
  });
});

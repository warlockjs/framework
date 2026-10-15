import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESTART_EXIT_CODE, WORKER_ENV_FLAG } from "../../../src/dev-server/supervisor";

const devLogError = vi.fn();

vi.mock("../../../src/dev-server/dev-logger", () => ({
  devLogError: (...args: unknown[]) => devLogError(...args),
  devServeLog: () => {},
}));

const { restartDevServer } = await import("../../../src/dev-server/restart-dev-server");

describe("restartDevServer", () => {
  const originalFlag = process.env[WORKER_ENV_FLAG];
  let shutdown: ReturnType<typeof vi.fn>;
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    shutdown = vi.fn(async () => undefined);
    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalFlag === undefined) delete process.env[WORKER_ENV_FLAG];
    else process.env[WORKER_ENV_FLAG] = originalFlag;
  });

  const devServer = () => ({ shutdown }) as never;

  it("shuts down and asks the supervisor for a fresh process", async () => {
    process.env[WORKER_ENV_FLAG] = "1";

    await restartDevServer(devServer());

    expect(shutdown).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(RESTART_EXIT_CODE);
  });

  it("shuts down BEFORE exiting, so the http port is free for the replacement", async () => {
    process.env[WORKER_ENV_FLAG] = "1";

    await restartDevServer(devServer());

    expect(shutdown.mock.invocationCallOrder[0]).toBeLessThan(
      (exit.mock.invocationCallOrder as number[])[0],
    );
  });

  it("declines without a supervisor instead of killing the server", async () => {
    delete process.env[WORKER_ENV_FLAG];

    await expect(restartDevServer(devServer())).resolves.toBe(false);

    expect(shutdown).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(devLogError).toHaveBeenCalledWith(expect.stringContaining("Restart is unavailable"));
  });

  it("declines when shutdown throws rather than exiting mid-teardown", async () => {
    process.env[WORKER_ENV_FLAG] = "1";
    shutdown.mockRejectedValue(new Error("connector hung"));

    await expect(restartDevServer(devServer())).resolves.toBe(false);

    expect(exit).not.toHaveBeenCalled();
    expect(devLogError).toHaveBeenCalledWith(expect.stringContaining("connector hung"));
  });
});

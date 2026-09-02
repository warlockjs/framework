import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawn = vi.fn();
const devLogError = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawn(...args),
}));

vi.mock("../../../src/dev-server/dev-logger", () => ({
  devLogError: (...args: unknown[]) => devLogError(...args),
  devLogWarn: () => {},
  devServeLog: () => {},
}));

const { isDevWorker, RESTART_EXIT_CODE, superviseDevServer, WORKER_ENV_FLAG } = await import(
  "../../../src/dev-server/supervisor"
);

/** A stand-in for a spawned worker whose exit we drive by hand. */
function createWorker() {
  const worker = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
  worker.kill = vi.fn();
  return worker;
}

describe("supervisor", () => {
  const originalFlag = process.env[WORKER_ENV_FLAG];
  let workers: ReturnType<typeof createWorker>[];
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    workers = [];
    spawn.mockImplementation(() => {
      const worker = createWorker();
      workers.push(worker);
      return worker;
    });

    exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    delete process.env[WORKER_ENV_FLAG];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGHUP");

    if (originalFlag === undefined) delete process.env[WORKER_ENV_FLAG];
    else process.env[WORKER_ENV_FLAG] = originalFlag;
  });

  describe("isDevWorker", () => {
    it("is false in the supervisor and true in the worker", () => {
      expect(isDevWorker()).toBe(false);

      process.env[WORKER_ENV_FLAG] = "1";

      expect(isDevWorker()).toBe(true);
    });
  });

  it("spawns the worker with this exact node binary and the worker flag set", () => {
    void superviseDevServer();

    expect(spawn).toHaveBeenCalledOnce();

    const [command, args, options] = spawn.mock.calls[0] as [
      string,
      string[],
      { env: NodeJS.ProcessEnv; stdio: string },
    ];

    expect(command).toBe(process.execPath);
    expect(args).toEqual([...process.execArgv, ...process.argv.slice(1)]);
    expect(options.env[WORKER_ENV_FLAG]).toBe("1");
    expect(options.stdio).toBe("inherit");
  });

  it("replaces a worker that asks for a restart, without deepening the tree", () => {
    void superviseDevServer();

    workers[0].emit("exit", RESTART_EXIT_CODE, null);

    // A second worker, spawned by the SAME supervisor — not a nested one.
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(exit).not.toHaveBeenCalled();

    workers[1].emit("exit", RESTART_EXIT_CODE, null);

    expect(spawn).toHaveBeenCalledTimes(3);
    expect(exit).not.toHaveBeenCalled();
  });

  it("mirrors an ordinary worker exit code and stops", () => {
    void superviseDevServer();

    workers[0].emit("exit", 0, null);

    expect(spawn).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("mirrors a failure exit code", () => {
    void superviseDevServer();

    workers[0].emit("exit", 1, null);

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("reports a signalled worker as a failure", () => {
    void superviseDevServer();

    workers[0].emit("exit", null, "SIGKILL");

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits 1 when the worker cannot be started at all", () => {
    void superviseDevServer();

    workers[0].emit("error", new Error("ENOENT"));

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("does not act on SIGINT itself — the worker gets it from the terminal", () => {
    void superviseDevServer();

    process.emit("SIGINT");

    expect(exit).not.toHaveBeenCalled();
    expect(workers[0].kill).not.toHaveBeenCalled();
  });

  it("does not respawn after Ctrl+C, even if the worker exits with the restart code", () => {
    void superviseDevServer();

    process.emit("SIGINT");
    workers[0].emit("exit", RESTART_EXIT_CODE, null);

    expect(spawn).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(RESTART_EXIT_CODE);
  });

  it("forwards SIGTERM to the worker and then stops", () => {
    void superviseDevServer();

    process.emit("SIGTERM");

    expect(workers[0].kill).toHaveBeenCalledWith("SIGTERM");

    workers[0].emit("exit", 0, null);

    expect(spawn).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  describe("crash recovery", () => {
    /** A clock we advance by hand so uptime is exact, not wall-clock-dependent. */
    function clock(start = 1_000_000) {
      let value = start;
      return {
        now: () => value,
        advance: (ms: number) => {
          value += ms;
        },
      };
    }

    it("replaces a worker that dies after running healthily", () => {
      const time = clock();

      void superviseDevServer(time.now);

      time.advance(30_000);
      workers[0].emit("exit", 1, null);

      expect(spawn).toHaveBeenCalledTimes(2);
      expect(exit).not.toHaveBeenCalled();
    });

    it("replaces a worker killed by a signal after running healthily", () => {
      const time = clock();

      void superviseDevServer(time.now);

      time.advance(30_000);
      workers[0].emit("exit", null, "SIGSEGV");

      expect(spawn).toHaveBeenCalledTimes(2);
    });

    it("does NOT replace a worker that died during boot — the error is already on screen", () => {
      const time = clock();

      void superviseDevServer(time.now);

      // A broken config exits almost immediately, having printed why.
      time.advance(400);
      workers[0].emit("exit", 1, null);

      expect(spawn).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledWith(1);
    });

    it("does not replace a worker that exited cleanly", () => {
      const time = clock();

      void superviseDevServer(time.now);

      time.advance(30_000);
      workers[0].emit("exit", 0, null);

      expect(spawn).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledWith(0);
    });

    it("gives up once the worker flaps past the limit inside the window", () => {
      const time = clock();

      void superviseDevServer(time.now);

      // Three crashes, each after a healthy-looking run, are recovered.
      for (let crash = 0; crash < 3; crash++) {
        time.advance(6_000);
        workers[crash].emit("exit", 1, null);
      }

      expect(spawn).toHaveBeenCalledTimes(4);
      expect(exit).not.toHaveBeenCalled();

      // The fourth inside the same window is flapping, not bad luck.
      time.advance(6_000);
      workers[3].emit("exit", 1, null);

      expect(spawn).toHaveBeenCalledTimes(4);
      expect(exit).toHaveBeenCalledWith(1);
      expect(devLogError).toHaveBeenCalledOnce();
      expect(devLogError).toHaveBeenCalledWith(
        expect.stringContaining("not restarting again"),
      );
    });

    it("ignores a stale worker exit while its healthy successor remains active", () => {
      const time = clock();

      void superviseDevServer(time.now);

      time.advance(6_000);
      workers[0].emit("exit", 1, null);

      expect(spawn).toHaveBeenCalledTimes(2);

      // Model delayed stale lifecycle delivery after the replacement has been
      // running healthily. It must not consume the current worker's crash
      // budget or produce a terminal status for that live worker.
      time.advance(6_000);
      for (let event = 0; event < 3; event++) {
        workers[0].emit("exit", 1, null);
      }

      expect(spawn).toHaveBeenCalledTimes(2);
      expect(exit).not.toHaveBeenCalled();
      expect(devLogError).not.toHaveBeenCalled();
    });

    it("forgives crashes that have aged out of the window", () => {
      const time = clock();

      void superviseDevServer(time.now);

      for (let crash = 0; crash < 3; crash++) {
        time.advance(6_000);
        workers[crash].emit("exit", 1, null);
      }

      expect(spawn).toHaveBeenCalledTimes(4);

      // Well past the 60s window — the earlier crashes no longer count.
      time.advance(120_000);
      workers[3].emit("exit", 1, null);

      expect(spawn).toHaveBeenCalledTimes(5);
      expect(exit).not.toHaveBeenCalled();
    });

    it("still honours an explicit restart request during boot", () => {
      const time = clock();

      void superviseDevServer(time.now);

      // `u`/`r` can fire before the healthy-uptime threshold; that is a
      // request, not a crash, so the uptime rule must not swallow it.
      time.advance(200);
      workers[0].emit("exit", RESTART_EXIT_CODE, null);

      expect(spawn).toHaveBeenCalledTimes(2);
      expect(exit).not.toHaveBeenCalled();
    });
  });

  it("never resolves, so nothing downstream of it runs in the supervisor", async () => {
    const settled = vi.fn();

    void superviseDevServer().then(settled, settled);

    await new Promise((resolve) => setImmediate(resolve));

    expect(settled).not.toHaveBeenCalled();
  });
});

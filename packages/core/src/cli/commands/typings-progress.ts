/** How often a stage that is still running reports itself, in milliseconds. */
const HEARTBEAT_MS = 15_000;

/**
 * The environment variable that adds the resources the process is waiting on
 * (timers, child processes, sockets) to every heartbeat, for finding what holds
 * a stage open.
 */
export const TYPINGS_DEBUG_ENV = "WARLOCK_DEBUG_TYPINGS";

type Write = (line: string) => void;

/**
 * Progress for `warlock generate.typings`, written to stderr.
 *
 * Each stage prints when it starts and when it ends with its duration, and a
 * stage that is still running prints a heartbeat every 15 seconds naming the
 * stage, the time spent and the active handle kinds — so a slow step (the route
 * registration child on a large app, an app config that keeps a connection open)
 * is visible instead of reading as a hang. The timer is unref'd and never keeps
 * the process alive.
 */
export function createTypingsProgress(options: { write?: Write; heartbeatMs?: number } = {}) {
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const debug = process.env[TYPINGS_DEBUG_ENV] === "1";

  return {
    /** Run one named stage, reporting its start, heartbeats and end. */
    async stage<T>(name: string, run: () => Promise<T>): Promise<T> {
      const started = Date.now();
      write(`generate.typings: ${name}…`);

      const timer = setInterval(() => {
        const seconds = Math.round((Date.now() - started) / 1000);
        const resources = debug
          ? ` [waiting on: ${activeResources().join(", ") || "nothing"}]`
          : "";

        write(`generate.typings: still ${name} after ${seconds} s${resources}`);
      }, heartbeatMs);

      timer.unref();

      try {
        const result = await run();

        write(`generate.typings: ${name} done in ${Date.now() - started} ms`);

        return result;
      } catch (error) {
        write(`generate.typings: ${name} failed after ${Date.now() - started} ms`);

        throw error;
      } finally {
        clearInterval(timer);
      }
    },
  };
}

/** The kinds of resources keeping the event loop busy, counted (`Timeout x2, TCPWrap`). */
function activeResources(): string[] {
  const counts = new Map<string, number>();

  for (const kind of process.getActiveResourcesInfo()) {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  return [...counts].map(([kind, count]) => (count > 1 ? `${kind} x${count}` : kind));
}

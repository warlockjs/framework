import type { InspectReport } from "../inspect/inspect-report.types";
import { writeAgentsMd, type WriteAgentsMdResult } from "./write-agents-md";

/** Options of {@link createAgentsMdRefresher}. */
export type AgentsMdRefresherOptions = {
  /** Project root. Default: `process.cwd()`. */
  cwd?: string;
  /** Produce a fresh report (the dev server calls `inspectApp()` in-process). */
  collect: () => Promise<InspectReport>;
  /** Quiet period after the last `schedule()` before a refresh runs. Default: 1000 ms. */
  debounceMs?: number;
  /** Create AGENTS.md when it is missing. Default: `true`. */
  create?: boolean;
  /** Called with each refresh's result. */
  onWrite?: (result: WriteAgentsMdResult) => void;
  /** Called when a refresh fails; the error never escapes the timer. */
  onError?: (error: unknown) => void;
};

/** A debounced AGENTS.md refresher. */
export type AgentsMdRefresher = {
  /** Ask for a refresh; calls within `debounceMs` of each other collapse into one. */
  schedule(): void;
  /** Run a pending (or, with none pending, a fresh) refresh now and wait for it. */
  flush(): Promise<void>;
  /** Cancel a pending refresh; later `schedule()` calls do nothing. */
  dispose(): void;
};

/**
 * Keep AGENTS.md's generated section current while `warlock dev` runs: the
 * server calls `schedule()` on boot and after each reload that changed
 * routes or modules, and one refresh runs once the burst settles. Refreshes
 * never overlap; a request made during one runs after it.
 *
 * @example
 * const refresher = createAgentsMdRefresher({
 *   collect: () => inspectApp({ sections: ["routes", "models", "packages"] }),
 *   onError: (error) => devLogWarn(`AGENTS.md not refreshed: ${String(error)}`),
 * });
 * refresher.schedule();
 */
export function createAgentsMdRefresher(options: AgentsMdRefresherOptions): AgentsMdRefresher {
  const debounceMs = options.debounceMs ?? 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  let disposed = false;

  const refresh = async (): Promise<void> => {
    try {
      const report = await options.collect();
      const result = writeAgentsMd({ cwd: options.cwd, report, create: options.create });

      options.onWrite?.(result);
    } catch (error) {
      options.onError?.(error);
    }
  };

  const run = (): Promise<void> => {
    running = running.then(refresh);
    return running;
  };

  return {
    schedule() {
      if (disposed) return;
      if (timer !== undefined) clearTimeout(timer);

      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, debounceMs);
      timer.unref?.();
    },
    async flush() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }

      if (disposed) {
        await running;
        return;
      }

      await run();
    },
    dispose() {
      disposed = true;

      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

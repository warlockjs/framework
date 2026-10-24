import { spawn } from "node:child_process";
import type { CommandResult, CommandRunner } from "./types";

const OUTPUT_LIMIT = 8000;

/**
 * Default runner: the command goes through the shell, so config entries such
 * as `NODE_ENV=production npx warlock build` work as written. Output is
 * captured (the tail is kept) rather than streamed.
 *
 * On timeout only the child this function started is signalled.
 */
export const shellRunner: CommandRunner = (command, options) =>
  new Promise<CommandResult>((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-OUTPUT_LIMIT);
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, output: `${output}${error.message}`.slice(-OUTPUT_LIMIT) });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, output, timedOut });
    });
  });

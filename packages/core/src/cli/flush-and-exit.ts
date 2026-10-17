/** How long to wait for stdout/stderr to drain before exiting anyway. */
const FLUSH_BUDGET_MS = 500;

function drain(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    // A zero-length write's callback fires once everything queued ahead of it
    // has been handed to the OS.
    stream.write("", () => resolve());
  });
}

/**
 * Exit with `code` once everything already written to stdout and stderr has
 * been flushed.
 *
 * For commands whose exit code carries meaning (`warlock check` exits 1 for
 * problems in the code and 2 for problems with the machine): a bare
 * `process.exit()` right after printing a large JSON report to a pipe can cut
 * the report short. Awaited inside the action, so the CLI never goes on to
 * print its success banner or exit 0.
 *
 * @param code The process exit code.
 */
export async function flushAndExit(code: number): Promise<never> {
  process.exitCode = code;

  let timer: NodeJS.Timeout | undefined;

  await Promise.race([
    Promise.all([drain(process.stdout), drain(process.stderr)]),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, FLUSH_BUDGET_MS);
      timer.unref?.();
    }),
  ]);

  if (timer) clearTimeout(timer);

  return process.exit(code);
}

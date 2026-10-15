/**
 * Run `task` with `console.log`/`console.info` redirected to stderr, restoring
 * them afterwards. Machine-readable output (`--json`) owns stdout, so progress
 * lines printed while booting ("processing 64 files...") must not share it.
 *
 * @param task - The work whose incidental logging must stay off stdout
 * @returns Whatever `task` resolves to
 */
export async function withConsoleOnStderr<T>(task: () => Promise<T>): Promise<T> {
  const { log, info } = console;

  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);

  try {
    return await task();
  } finally {
    console.log = log;
    console.info = info;
  }
}

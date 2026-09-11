import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `warlock add <feature> --no-install` finishes its work and then never
 * exits — captured by the release gate (`release/5.4-findings.md` §12):
 *
 *   warlock add react exited 4294967295:
 *     ✔ add <features...> completed successfully (13ms)
 *
 * The command printed success in 13ms and then sat at ZERO CPU for 67
 * minutes until the gate killed it. `stdin` was `ignore`, so nothing was
 * waiting on input — something kept the Node event loop alive after the
 * action returned.
 *
 * Root cause: `dev-server/shortcuts.ts` exported a process-wide
 * `DevServerShortcuts` singleton whose constructor DEFAULTED its `input`
 * parameter to `process.stdin`. Default parameters evaluate at call time,
 * so merely constructing that singleton touched `process.stdin` and made
 * Node allocate a real stdin handle. `cli/framework-cli-commands.ts`
 * statically imports every command module — `dev-server.command.ts`
 * included — so that singleton (and the `process.stdin` touch) was
 * constructed on EVERY `warlock` invocation, `add` included, regardless of
 * whether the command has anything to do with the dev server. Under
 * `stdio: ["ignore", "pipe", "pipe"]` (exactly how the gate spawns a child,
 * and how this test spawns the CLI below) that handle could keep the loop
 * alive well past `exitAfterFlush`'s own safety margin.
 *
 * The fix (`dev-server/shortcuts.ts`) resolves `process.stdin` lazily, from
 * a getter, only when a caller that actually offers a shortcut touches it
 * (`isSupported`/`register`/`listen`/`release`) — never at construction.
 *
 * This is the honest form of guard for "the process didn't exit": it spawns
 * the REAL CLI (`bin/warlock.js`, which falls back to compiling
 * `src/cli/start.ts` from source when no `esm/` build exists next to it —
 * exactly this checkout's own layout) against a throwaway fixture app, with
 * the same stdio shape the release gate uses, and asserts the child process
 * terminates ON ITS OWN within a bound. A regression that reintroduces an
 * un-unref'd handle on this path makes this test time out, not merely read
 * a wrong value — a text-matching assertion cannot fail this way.
 */

const CORE_ROOT = path.resolve(__dirname, "../../..");
const WARLOCK_BIN = path.join(CORE_ROOT, "bin", "warlock.js");

/**
 * Bound on the whole spawn-to-exit round trip. Generous: `bootFromSource()`
 * registers an esbuild TypeScript loader and compiles `src/cli/start.ts`'s
 * transitive graph on every cold run, which is real (multi-second) cost on
 * this checkout — see `bin/warlock.js`'s own doc comment. What matters here
 * is that the child exits on its own well inside this bound; the original
 * defect held the process open for 67 MINUTES with zero CPU, so any sane
 * bound below that distinguishes "works" from "the bug is back".
 */
const CHILD_TIMEOUT_MS = 180_000;

/*
 * Why 180s and not 30s: MEASURED on 2026-09-11, on an idle machine, this exact
 * spawn prints nothing for ~10s (cold compile of `src/cli/start.ts`'s graph),
 * then completes in 10-50ms and exits 0 — twice: firstOutput 9919ms/10406ms,
 * exit 10003ms/10587ms. The old 30s bound was ~3x a cost that is CPU-BOUND and
 * runs while this file's own suite saturates every core, so a full-suite run
 * timed out with EMPTY stdout — the child never reached its first byte. That
 * reads as "the process did not exit" and is indistinguishable, at the
 * assertion, from the defect above.
 *
 * Raising it does not weaken the guard: the defect held the process open for
 * 67 MINUTES at zero CPU, so 180s separates "slow cold boot under load" from
 * "the handle is back" just as well as 30s did — and unlike 30s, it does not
 * fire on the innocent case. Card 7d27d05d.
 */

let fixtureDir: string;

beforeEach(async () => {
  fixtureDir = await mkdtemp(path.join(os.tmpdir(), "warlock-add-exit-"));

  // The minimum `add --no-install` needs: a readable/writable package.json.
  // `image` (`src/generations/features/image.feature.ts`) has no
  // `ejectConfig` and no `onExecuting` — it only records a dependency — so
  // this fixture does not need a `src/` tree at all.
  await writeFile(
    path.join(fixtureDir, "package.json"),
    JSON.stringify({ name: "add-exit-fixture", version: "1.0.0", dependencies: {}, devDependencies: {} }, null, 2),
  );
});

afterEach(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("warlock add <feature> --no-install exits on its own", () => {
  it(
    "the child process terminates without being killed, within the timeout bound",
    async () => {
      const exitInfo = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; stdout: string }>(
        (resolve) => {
          const child = spawn(process.execPath, [WARLOCK_BIN, "add", "image", "--no-install"], {
            cwd: fixtureDir,
            // Exactly the shape the release gate spawns with — `stdin` ignored,
            // so nothing is ever waiting on input, and the defect was that
            // something ELSE still kept the loop open regardless.
            stdio: ["ignore", "pipe", "pipe"],
          });

          let stdout = "";
          child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
          child.stderr.on("data", (chunk) => (stdout += chunk.toString()));

          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill("SIGKILL");
            resolve({ code: null, signal: null, timedOut: true, stdout });
          }, CHILD_TIMEOUT_MS);

          child.once("exit", (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ code, signal, timedOut: false, stdout });
          });
        },
      );

      // The defect's whole shape: the work finishes and prints success, and
      // ONLY THEN does the process fail to exit. Assert both halves —
      // finishing the work is necessary but not sufficient.
      expect(exitInfo.stdout).toContain("completed successfully");
      expect(exitInfo.timedOut).toBe(false);
      expect(exitInfo.signal).toBeNull();
      expect(exitInfo.code).toBe(0);
    },
    CHILD_TIMEOUT_MS + 5_000,
  );
});

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * End-to-end: `warlock add <feature> --no-install` completes its work AND the
 * real CLI process exits 0 on its own, within a bound — spawned exactly the way
 * the release gate spawns a child.
 *
 * ─── What this test proves, and what it does NOT (finding 10a8ea45) ─────────
 *
 * The ORIGINAL defect (release gate `release/5.4-findings.md` §12): `warlock
 * add react` printed "completed successfully" in 13ms, then sat at ZERO CPU
 * for 67 minutes until the gate killed it. Root cause: `dev-server/shortcuts.ts`
 * exported a process-wide `DevServerShortcuts` singleton whose constructor
 * DEFAULTED `input` to `process.stdin`. Default params evaluate at call time,
 * so merely constructing that singleton — which `framework-cli-commands.ts`
 * does on EVERY `warlock` invocation, `add` included, by statically importing
 * every command module — touched `process.stdin` and made Node allocate a real
 * stdin handle nobody asked for. The fix resolves `process.stdin` lazily from a
 * getter, only when a caller actually offers a shortcut, never at construction.
 *
 * This test used to be sold as THE guard for that defect, on the theory that a
 * reintroduced un-unref'd stdin handle would make the child time out here. That
 * is NO LONGER TRUE: on Node 25.9.0 an un-unref'd `process.stdin` handle under
 * `stdio: ["ignore", ...]` does not keep the loop alive, so reintroducing the
 * exact constructor-default defect leaves this test GREEN (verified 2026-09-13:
 * defect reintroduced → child still exits 0 in ~12s). A red-first control on
 * this test therefore does not go red — it cannot honestly claim to guard the
 * stdin-handle regression (canon 4a7f3259).
 *
 * The stdin-handle regression is guarded DIRECTLY, with a LIVE red control, by
 * `tests/unit/dev-server/shortcuts-lazy-stdin.test.ts`: it wraps the real
 * `process.stdin` getter and asserts constructing `DevServerShortcuts` never
 * reads it. Reintroduce the constructor default and THAT test fails immediately
 * — the honest guard for this defect.
 *
 * What THIS test still legitimately proves, and why it is kept: the real CLI
 * path for `add --no-install` runs to completion and the process terminates 0
 * on its own within a bound. It spawns `bin/warlock.js` (which compiles
 * `src/cli/start.ts` from source when no `esm/` build sits beside it — this
 * checkout's layout) against a throwaway fixture, with the release gate's stdio
 * shape. It still catches add-path breakage (a crash, a non-zero exit, work
 * that never finishes) AND any FUTURE handle leak that DOES keep the Node 25.9
 * loop alive (a timer, a socket, a listening server) — the class of regression
 * a text-matching assertion cannot catch. It is a boot/exit smoke test, not the
 * stdin-handle guard.
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

describe("warlock add <feature> --no-install completes and the CLI exits 0 on its own (boot/exit smoke test; NOT the stdin-handle guard — see shortcuts-lazy-stdin.test.ts)", () => {
  it(
    "completes the add and the child process terminates 0 without being killed, within the timeout bound",
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

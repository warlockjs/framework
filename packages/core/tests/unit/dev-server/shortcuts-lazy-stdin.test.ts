import { describe, expect, it } from "vitest";
import { DevServerShortcuts } from "../../../src/dev-server/shortcuts";

/**
 * `dev-server/shortcuts.ts` exports a process-wide `devServerShortcuts`
 * singleton (`new DevServerShortcuts()`, no arguments). Before the fix, the
 * constructor's `input` parameter DEFAULTED to `process.stdin` —
 * `constructor(private readonly input: NodeJS.ReadStream = process.stdin, ...)`.
 * Default parameters evaluate at call time, so simply constructing that
 * singleton touched `process.stdin`, and Node allocates a real handle
 * (a `net.Socket`/`tty.ReadStream`/`fs.ReadStream`, depending on what fd 0
 * is) the first time `process.stdin` is read — regardless of whether
 * anything ever calls `register()`.
 *
 * `cli/framework-cli-commands.ts` statically imports every command module,
 * `dev-server.command.ts` included, so that singleton is constructed on
 * EVERY `warlock` invocation — `add`, `migrate`, `routes`, all of them —
 * never gated behind a preload check. That is the release gate's captured
 * defect (`release/5.4-findings.md` §12): `warlock add react` printed
 * "completed successfully" and then sat at zero CPU for 67 minutes with
 * nothing waiting on stdin, because something else had quietly built a
 * stdin handle nobody asked for.
 *
 * The fix resolves `input` from a lazy getter — `explicitInput ??
 * process.stdin` — read only by the methods that actually manage a
 * terminal (`isSupported`/`register`/`listen`/`release`). This test proves
 * the touch is gone at construction time, which a text-matching assertion
 * on source code could not: it observes the REAL `process.stdin` getter
 * being invoked (or not), not a description of the code that would invoke
 * it.
 *
 * This is THE guard for that exit-hang defect (finding 10a8ea45), and it has a
 * LIVE red control: reintroduce the constructor default (`explicitInput:
 * NodeJS.ReadStream = process.stdin`) and this test fails immediately. The
 * spawn-based `tests/integration/cli/add-command-process-exit.test.ts` used to
 * claim this role, but on Node 25.9.0 an un-unref'd stdin handle no longer
 * keeps the loop alive, so it stays GREEN with the defect present — it can no
 * longer fail from this regression. The direct assertion here replaces that
 * dead timeout-based control (canon 4a7f3259).
 */
describe("DevServerShortcuts", () => {
  it("does not read process.stdin merely by being constructed with no explicit input", () => {
    const original = Object.getOwnPropertyDescriptor(process, "stdin");
    expect(original?.get).toBeDefined();

    let accessCount = 0;
    Object.defineProperty(process, "stdin", {
      configurable: true,
      enumerable: original!.enumerable,
      get() {
        accessCount++;
        return original!.get!.call(this);
      },
    });

    try {
      // eslint-disable-next-line no-new -- constructing IS the assertion.
      new DevServerShortcuts();

      expect(accessCount).toBe(0);
    } finally {
      Object.defineProperty(process, "stdin", original!);
    }
  });
});

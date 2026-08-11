import { describe, expect, it } from "vitest";
import { exitCodeFor, PENDING_EXIT_CODE } from "../../../src/database/pending-exit-code";

/**
 * `--pending` is a gate. Its exit code is the entire API for a script, so the
 * codes are pinned by value here — a renumbering is a breaking change to every
 * `migrate --pending && deploy` in the wild, and must fail loudly rather than
 * pass because the constants moved together.
 */
describe("pending exit codes", () => {
  it("pins the three codes by value", () => {
    expect(PENDING_EXIT_CODE.clear).toBe(0);
    expect(PENDING_EXIT_CODE.pending).toBe(1);
    expect(PENDING_EXIT_CODE.unavailable).toBe(2);
  });

  it("exits 0 when the set was computed and is empty", () => {
    expect(exitCodeFor({ type: "resolved", migrations: [] })).toBe(0);
  });

  it("exits 1 when migrations are pending", () => {
    expect(exitCodeFor({ type: "resolved", migrations: [{ name: "create_users" }] })).toBe(1);
  });

  it("exits 2 when the set could not be computed", () => {
    expect(exitCodeFor({ type: "unavailable", reason: "broken migration file" })).toBe(2);
  });

  it("keeps 'unavailable' and 'clear' as different doors", () => {
    const unavailable = exitCodeFor({ type: "unavailable", reason: "anything" });
    const clear = exitCodeFor({ type: "resolved", migrations: [] });

    // The whole point of a third code: `migrate --pending && deploy` must not
    // proceed on an unknown, and a script must be able to tell an unknown from
    // a backlog.
    expect(unavailable).not.toBe(clear);
    expect(unavailable).not.toBe(exitCodeFor({ type: "resolved", migrations: [{ name: "x" }] }));
  });
});

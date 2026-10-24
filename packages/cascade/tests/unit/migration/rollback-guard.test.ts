import { afterEach, describe, expect, it, vi } from "vitest";
import { migrationRunner } from "../../../src/migration/migration-runner";
import type { RollbackPlan } from "../../../src/migration/types";
import {
  confirmRollback,
  formatRollbackPlan,
  hasDestructiveOperations,
} from "../../../src/operations/rollback-guard";

const destructivePlan: RollbackPlan = [
  {
    name: "add-phone",
    table: "users",
    operations: [
      {
        type: "dropFields",
        table: "users",
        store: "document",
        fields: ["phone"],
        applied: true,
        count: 42,
      },
    ],
  },
  { name: "ledger-only", table: "posts", operations: [] },
];

const harmlessPlan: RollbackPlan = [
  {
    name: "mirrored",
    table: "users",
    operations: [
      { type: "dropFields", table: "users", store: "document", fields: ["phone"], applied: false },
    ],
  },
];

function planReturns(plan: RollbackPlan) {
  return vi.spyOn(migrationRunner, "planRollback").mockResolvedValue(plan);
}

afterEach(() => vi.restoreAllMocks());

describe("formatRollbackPlan", () => {
  it("lists fields, collections and counts", () => {
    expect(formatRollbackPlan(destructivePlan).join("\n")).toContain(
      'unset field(s) phone on collection "users" [42 document(s)]',
    );
  });

  it("counts ledger-only migrations", () => {
    expect(formatRollbackPlan(destructivePlan).join("\n")).toContain("1 migration(s) only update");
  });

  it("marks skipped drops", () => {
    expect(formatRollbackPlan(harmlessPlan).join("\n")).toContain("SKIPPED");
  });
});

describe("hasDestructiveOperations", () => {
  it("ignores skipped and ledger-only entries", () => {
    expect(hasDestructiveOperations(harmlessPlan)).toBe(false);
    expect(hasDestructiveOperations(destructivePlan)).toBe(true);
  });
});

describe("confirmRollback", () => {
  it("prints the summary in development and proceeds without asking", async () => {
    planReturns(destructivePlan);
    const print = vi.fn();
    const confirm = vi.fn();

    await expect(confirmRollback({ development: true, print, confirm })).resolves.toBe(true);
    expect(print).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks outside development and honours the answer", async () => {
    planReturns(destructivePlan);
    const options = { development: false, interactive: true, print: vi.fn() };

    await expect(confirmRollback({ ...options, confirm: async () => true })).resolves.toBe(true);
    await expect(confirmRollback({ ...options, confirm: async () => false })).resolves.toBe(false);
  });

  it("proceeds with --yes without asking", async () => {
    planReturns(destructivePlan);
    const confirm = vi.fn();

    await expect(
      confirmRollback({ development: false, yes: true, interactive: false, print: vi.fn(), confirm }),
    ).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("refuses without a terminal and without --yes", async () => {
    planReturns(destructivePlan);

    await expect(
      confirmRollback({ development: false, interactive: false, print: vi.fn() }),
    ).rejects.toThrow(/--yes/);
  });

  it("does not ask when nothing is removed", async () => {
    planReturns(harmlessPlan);
    const confirm = vi.fn();

    await expect(
      confirmRollback({ development: false, interactive: false, print: vi.fn(), confirm }),
    ).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("plans every batch for all: true", async () => {
    const spy = planReturns([]);

    await confirmRollback({ all: true, print: vi.fn() });

    expect(spy).toHaveBeenCalledWith(Number.POSITIVE_INFINITY);
  });
});

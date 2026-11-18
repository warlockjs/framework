import { describe, expect, it } from "vitest";
import {
  accountPatchToRow,
  accountToRow,
  auditToRow,
  inviteToRow,
  parseJson,
  reportToRow,
  rowToAccount,
  rowToAudit,
  rowToInvite,
  rowToReport,
  rowToSample,
  rowToSession,
  rowToShare,
  rowToState,
  sampleToRow,
  sessionPatchToRow,
  sessionToRow,
  shareToRow,
  stateToRow,
  statePatchToRow,
  toBoolean,
  toNumber,
} from "../../../src/production/store/mapping";
import { defaultStateRecord } from "../../../src/production/store/memory-store";
import type {
  DevtoolsAccountRecord,
  DevtoolsSessionRecord,
} from "../../../src/production/store/types";
import { auditEntry, newAccount, newInvite, newSession, report, sample } from "./store-contract";

const account: DevtoolsAccountRecord = {
  ...newAccount("a@example.com", { role: "admin", totpSecret: "s", recoveryCodes: ["x"] }),
  id: "id1",
  createdAt: 1,
  updatedAt: 2,
  version: 3,
};

describe("row mapping", () => {
  it("round-trips an account", () => {
    const row = accountToRow(account);

    expect(row).toMatchObject({
      id: "id1",
      password_hash: "hash",
      must_change_password: false,
      recovery_codes: ["x"],
      created_at: 1,
      version: 3,
    });
    expect(rowToAccount(row)).toEqual(account);
  });

  it("reads numbers a driver returned as strings, and JSON given as text", () => {
    const row = {
      ...accountToRow(account),
      created_at: "1",
      updated_at: "2",
      version: "3",
      totp_enabled_at: "9",
      recovery_codes: '["x","y"]',
      passkeys: "[]",
    };

    expect(rowToAccount(row)).toMatchObject({
      createdAt: 1,
      updatedAt: 2,
      version: 3,
      totpEnabledAt: 9,
      recoveryCodes: ["x", "y"],
      passkeys: [],
    });
  });

  it("maps only the fields a patch has", () => {
    expect(accountPatchToRow({ role: "admin", totpSecret: null })).toEqual({
      role: "admin",
      totp_secret: null,
    });
    expect(accountPatchToRow({})).toEqual({});
    expect(sessionPatchToRow({ lastSeenAt: 5, challenge: null })).toEqual({
      last_seen_at: 5,
      challenge: null,
    });
    expect(statePatchToRow({ lockedUntil: 7 })).toEqual({ locked_until: 7 });
  });

  it("round-trips a session", () => {
    const record: DevtoolsSessionRecord = {
      ...newSession("acc", "h", { challenge: "c", challengeExpiresAt: 4 }),
      id: "s1",
      version: 2,
    };

    expect(rowToSession(sessionToRow(record))).toEqual(record);
  });

  it("round-trips an invite", () => {
    const record = { ...newInvite("t"), id: "i1", usedAt: 5, accountId: "acc" };

    expect(rowToInvite(inviteToRow(record))).toEqual(record);
  });

  it("round-trips an audit entry under occurred_at", () => {
    const entry = { ...auditEntry(10, { detail: { a: 1, b: null } }), id: "e1" };
    const row = auditToRow(entry);

    expect(row.occurred_at).toBe(10);
    expect(rowToAudit(row)).toEqual(entry);
  });

  it("round-trips the state row", () => {
    const record = { ...defaultStateRecord(5), disabled: true, disabledPathHash: "h", version: 2 };

    expect(rowToState(stateToRow(record))).toEqual(record);
  });

  it("keeps a sample's detail as JSON text and upper-cases the method", () => {
    const stored = sample("r1", 100, { method: "get" });
    const row = sampleToRow(stored);

    expect(row.method).toBe("GET");
    expect(row.status).toBe(200);
    expect(typeof row.detail).toBe("string");
    expect(rowToSample(row)).toEqual(stored);
    expect(rowToSample(sampleToRow(sample("r2", 1, { detail: false }))).detail).toBeNull();
    expect(sampleToRow(sample("r3", 1, { status: undefined })).status).toBeNull();
  });

  it("keeps a report as JSON text keyed by the instance", () => {
    const row = reportToRow(report("inst", 50));

    expect(row).toMatchObject({ id: "inst", seen_at: 50 });
    expect(typeof row.data).toBe("string");
    expect(rowToReport(row)).toEqual(report("inst", 50));
  });

  it("converts loosely typed values", () => {
    expect(toNumber("12")).toBe(12);
    expect(toNumber(null)).toBe(0);
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(0)).toBe(false);
    expect(toBoolean("t")).toBe(true);
    expect(parseJson("not json", [])).toEqual([]);
    expect(parseJson(undefined, { a: 1 })).toEqual({ a: 1 });
  });
});

describe("share row mapping", () => {
  const record = {
    id: "s1",
    tokenHash: "h".repeat(64),
    panel: "grimoire",
    label: "Review",
    createdBy: "a1",
    createdAt: 1,
    expiresAt: 2,
    revokedAt: null,
    lastUsedAt: 3,
    uses: 4,
  };

  it("round-trips a share link with snake_case columns", () => {
    const row = shareToRow(record);

    expect(row).toMatchObject({
      token_hash: record.tokenHash,
      created_by: "a1",
      expires_at: 2,
      revoked_at: null,
      last_used_at: 3,
      uses: 4,
    });
    expect(rowToShare(row)).toEqual(record);
  });

  it("reads bigint columns a driver returns as strings", () => {
    expect(
      rowToShare({ ...shareToRow(record), created_at: "10", expires_at: "20", revoked_at: "30" }),
    ).toMatchObject({ createdAt: 10, expiresAt: 20, revokedAt: 30 });
  });
});

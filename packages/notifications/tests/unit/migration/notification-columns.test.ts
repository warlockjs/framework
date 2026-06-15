import { describe, expect, it } from "vitest";
import { notificationColumns } from "../../../src/migration/notification-columns";

describe("notificationColumns", () => {
  it("defaults to the read_at-only column set (no model)", () => {
    const cols = notificationColumns();
    expect(Object.keys(cols)).toEqual([
      "user_id",
      "type",
      "title",
      "body",
      "payload",
      "read_at",
      "idempotency_key",
    ]);
  });

  it("uses the same defaults for a model with no columnMap", () => {
    const cols = notificationColumns({ columnMap: undefined });
    expect("user_id" in cols).toBe(true);
    expect("read_at" in cols).toBe(true);
    expect("is_read" in cols).toBe(false);
  });

  it("names the recipient + tenant columns from the columnMap", () => {
    const cols = notificationColumns({
      columnMap: { recipient: "audience_id", tenant: "organization_id", readAt: "read_at" },
    });
    expect("audience_id" in cols).toBe(true);
    expect("organization_id" in cols).toBe(true);
    expect("user_id" in cols).toBe(false);
  });

  it("emits an is_read boolean (and no read_at) for an isRead-only map", () => {
    const cols = notificationColumns({ columnMap: { isRead: "is_read" } });
    expect("is_read" in cols).toBe(true);
    expect("read_at" in cols).toBe(false);
  });

  it("emits both read-state columns when both are declared", () => {
    const cols = notificationColumns({ columnMap: { isRead: "is_read", readAt: "read_at" } });
    expect("is_read" in cols).toBe(true);
    expect("read_at" in cols).toBe(true);
  });

  it("honors renamed read-state columns", () => {
    const cols = notificationColumns({ columnMap: { readAt: "seen_at" } });
    expect("seen_at" in cols).toBe(true);
    expect("read_at" in cols).toBe(false);
  });
});

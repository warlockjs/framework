import { describe, expect, it } from "vitest";
import { notificationColumns } from "../../../src/migration/notification-columns";

describe("notificationColumns", () => {
  it("returns snake_case columns by default (no model)", () => {
    const cols = notificationColumns();
    expect(Object.keys(cols)).toEqual([
      "user_id",
      "type",
      "title",
      "body",
      "payload",
      "is_read",
      "read_at",
      "idempotency_key",
    ]);
  });

  it("returns snake_case columns for a model with no dataSource", () => {
    const cols = notificationColumns({ dataSource: undefined });
    expect("user_id" in cols).toBe(true);
    expect("userId" in cols).toBe(false);
  });

  it("returns snake_case columns for a PG/MySQL dataSource string", () => {
    const cols = notificationColumns({ dataSource: "postgres" });
    expect("is_read" in cols).toBe(true);
    expect("read_at" in cols).toBe(true);
  });

  it("returns camelCase columns for the literal 'mongodb' dataSource string", () => {
    const cols = notificationColumns({ dataSource: "mongodb" });
    expect(Object.keys(cols)).toEqual([
      "userId",
      "type",
      "title",
      "body",
      "payload",
      "isRead",
      "readAt",
      "idempotencyKey",
    ]);
  });

  it("returns camelCase columns for a DataSource object whose name is 'mongodb'", () => {
    const cols = notificationColumns({ dataSource: { name: "mongodb" } });
    expect("isRead" in cols).toBe(true);
    expect("is_read" in cols).toBe(false);
  });
});

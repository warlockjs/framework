import { describe, expect, it } from "vitest";
import { DatabaseWriterValidationError } from "../validation";
import { DatabaseWriter } from "./database-writer";

class Receipt {}

function mapViolation(error: unknown, isInsert = true): any {
  const writer = Object.create(DatabaseWriter.prototype) as any;
  writer.model = new Receipt();

  return writer.mapUniqueViolation(error, isInsert);
}

describe("DatabaseWriter unique violations", () => {
  it("postgres: names every column of a composite constraint without quotes", () => {
    const driverError = {
      code: "23505",
      constraint: "receipts_tenantId_receiptFileId_key",
      detail: 'Key ("tenantId", "receiptFileId")=(1, 2) already exists.',
    };

    const mapped = mapViolation(driverError);

    expect(mapped).toBeInstanceOf(DatabaseWriterValidationError);
    expect(mapped.errors).toEqual([
      {
        type: "unique",
        error: "The tenantId, receiptFileId must be unique",
        input: "tenantId, receiptFileId",
      },
    ]);
    expect(mapped.columns).toEqual(["tenantId", "receiptFileId"]);
    expect(mapped.constraint).toBe("receipts_tenantId_receiptFileId_key");
    expect(mapped.cause).toBe(driverError);
  });

  it("postgres: keeps a single column working", () => {
    const mapped = mapViolation({
      code: "23505",
      constraint: "users_email_key",
      detail: "Key (email)=(a@b.c) already exists.",
    });

    expect(mapped.errors[0].input).toBe("email");
    expect(mapped.columns).toEqual(["email"]);
  });

  it("mongodb: reads columns from keyPattern and the constraint from the index name", () => {
    const driverError = {
      code: 11000,
      keyPattern: { tenantId: 1, receiptFileId: 1 },
      message:
        "E11000 duplicate key error collection: db.receipts index: tenantId_1_receiptFileId_1 dup key",
    };

    const mapped = mapViolation(driverError, false);

    expect(mapped.columns).toEqual(["tenantId", "receiptFileId"]);
    expect(mapped.constraint).toBe("tenantId_1_receiptFileId_1");
    expect(mapped.errors[0].input).toBe("tenantId, receiptFileId");
    expect(mapped.cause).toBe(driverError);
  });

  it("returns other errors untouched", () => {
    const other = new Error("boom");

    expect(mapViolation(other)).toBe(other);
  });
});

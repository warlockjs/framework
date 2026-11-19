import { v } from "@warlock.js/seal";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { afterCommit } from "../../../src/transactions/after-commit";
import { Model } from "../../../src/model/model";
import {
  hasLocalPostgres,
  startLocalPostgresHarness,
  type LocalPostgresHarness,
} from "../helpers/local-postgres-harness";

/**
 * Live checks for snapshot round trips, savepoint transactions, json() array
 * columns and findOneAndUpdate inside a transaction. Touches only
 * `local_live560_*` tables. Skipped when LOCAL_PG_* is not configured.
 */

const suite = hasLocalPostgres() ? describe : describe.skip;

const ITEMS = "local_live560_items";
const LEDGER = "local_live560_ledger";
const TAGGED = "local_live560_tagged";

class Item extends Model {
  public static table = ITEMS;
  public static schema = v.object({
    name: v.string(),
    meta: v.object({ color: v.string(), sizes: v.array(v.number()) }).optional(),
    labels: v.array(v.string()).optional(),
    notes: v.array(v.string()).optional(),
  });
}

class Ledger extends Model {
  public static table = LEDGER;
}

class Tagged extends Model {
  public static table = TAGGED;
  public static schema = v.object({
    title: v.string(),
    tags: v.array(v.string()),
  });
}

suite("Postgres live: 5.60 cascade fixes", () => {
  let harness: LocalPostgresHarness;

  beforeAll(async () => {
    harness = await startLocalPostgresHarness();
    await harness.dropTables(ITEMS, LEDGER, TAGGED);
    await harness.query(
      `CREATE TABLE "${ITEMS}" (id SERIAL PRIMARY KEY, name TEXT, meta JSONB, labels TEXT[], notes JSON, created_at TIMESTAMPTZ DEFAULT now())`,
    );
    await harness.query(
      `CREATE TABLE "${LEDGER}" (id SERIAL PRIMARY KEY, key TEXT UNIQUE NOT NULL, amount INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`,
    );
    await harness.query(
      `CREATE TABLE "${TAGGED}" (id SERIAL PRIMARY KEY, title TEXT, tags JSON, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`,
    );
  });

  afterAll(async () => {
    await harness.dropTables(ITEMS, LEDGER, TAGGED);
    await harness.stop();
  });

  beforeEach(async () => {
    await harness.query(`TRUNCATE "${ITEMS}", "${LEDGER}", "${TAGGED}" RESTART IDENTITY`);
  });

  describe("snapshot cache round trip", () => {
    it("jsonb, text[] and json come back as JS values after a JSON-stored snapshot", async () => {
      await harness.query(
        `INSERT INTO "${ITEMS}" (name, meta, labels, notes) VALUES ($1, $2::jsonb, $3::text[], $4::json)`,
        [
          "Tea",
          JSON.stringify({ color: "red", sizes: [1, 2] }),
          ["a", "b"],
          JSON.stringify(["n1", "n2"]),
        ],
      );

      const fromDb = (await Item.first({}))!;
      expect(fromDb.get("meta")).toEqual({ color: "red", sizes: [1, 2] });

      // Cache miss -> store as JSON text -> hit
      const stored = JSON.stringify(fromDb.toSnapshot());
      const hit = Item.fromSnapshot(JSON.parse(stored));

      expect(hit.get("meta")).toEqual({ color: "red", sizes: [1, 2] });
      expect(hit.get("labels")).toEqual(["a", "b"]);
      expect(hit.get("notes")).toEqual(["n1", "n2"]);
      expect(hit.get("createdAt") ?? hit.get("created_at")).toBeDefined();
      expect(hit.data).toEqual(fromDb.data);
    });

    it("loads a 5.59-style legacy snapshot (JSON strings in object/array columns)", async () => {
      await harness.query(
        `INSERT INTO "${ITEMS}" (name, meta, labels, notes) VALUES ($1, $2::jsonb, $3::text[], $4::json)`,
        [
          "Tea",
          JSON.stringify({ color: "red", sizes: [1, 2] }),
          ["a", "b"],
          JSON.stringify(["n1"]),
        ],
      );

      const fromDb = (await Item.first({}))!;
      const modern = fromDb.toSnapshot() as any;
      const legacy = JSON.parse(JSON.stringify(modern));

      // 5.59 stored driver.serialize() output: JSON text for objects/arrays.
      legacy.data.meta = JSON.stringify(modern.data.meta);
      legacy.data.labels = JSON.stringify(modern.data.labels);
      legacy.data.notes = JSON.stringify(modern.data.notes);

      const hit = Item.fromSnapshot(legacy);

      expect(hit.get("meta")).toEqual({ color: "red", sizes: [1, 2] });
      expect(hit.get("labels")).toEqual(["a", "b"]);
      expect(hit.get("notes")).toEqual(["n1"]);
    });
  });

  describe("nested transaction savepoints", () => {
    it("rolls back the inner block only and drops its afterCommit callbacks", async () => {
      const calls: string[] = [];

      await harness.driver.transaction(async () => {
        await Ledger.create({ key: "outer-before", amount: 1 });
        afterCommit(() => {
          calls.push("outer");
        });

        await expect(
          harness.driver.transaction(
            async () => {
              await Ledger.create({ key: "inner", amount: 2 });
              afterCommit(() => {
                calls.push("inner");
              });
              throw new Error("inner failed");
            },
            { savepoint: true } as never,
          ),
        ).rejects.toThrow("inner failed");

        await Ledger.create({ key: "outer-after", amount: 3 });
      });

      const rows = await harness.query<{ key: string }>(`SELECT key FROM "${LEDGER}" ORDER BY id`);
      expect(rows.rows.map((r) => r.key)).toEqual(["outer-before", "outer-after"]);
      expect(calls).toEqual(["outer"]);
    });

    it("a successful savepoint block commits with the outer transaction", async () => {
      await harness.driver.transaction(async () => {
        await harness.driver.transaction(
          async () => {
            await Ledger.create({ key: "inner-ok", amount: 1 });
          },
          { savepoint: true } as never,
        );
      });

      const rows = await harness.query(`SELECT key FROM "${LEDGER}"`);
      expect(rows.rows).toHaveLength(1);
    });

    it("an outer rollback also undoes a released savepoint", async () => {
      await expect(
        harness.driver.transaction(async () => {
          await harness.driver.transaction(
            async () => {
              await Ledger.create({ key: "inner-ok", amount: 1 });
            },
            { savepoint: true } as never,
          );
          throw new Error("outer failed");
        }),
      ).rejects.toThrow("outer failed");

      const rows = await harness.query(`SELECT key FROM "${LEDGER}"`);
      expect(rows.rows).toHaveLength(0);
    });
  });

  describe("json() column backing v.array(v.string())", () => {
    it("accepts an insert and reads back an array", async () => {
      const created = await Tagged.create({ title: "post", tags: ["x", "y"] });
      const found = (await Tagged.find(created.id))!;

      expect(found.get("tags")).toEqual(["x", "y"]);

      const raw = await harness.query<{ tags: unknown }>(`SELECT tags FROM "${TAGGED}"`);
      expect(raw.rows[0].tags).toEqual(["x", "y"]);
    });

    it("accepts an empty array", async () => {
      const created = await Tagged.create({ title: "post", tags: [] });
      expect((await Tagged.find(created.id))!.get("tags")).toEqual([]);
    });
  });

  describe("findOneAndUpdate inside a transaction", () => {
    it("updates an existing row without an unknown-keys error", async () => {
      await Ledger.create({ key: "acct", amount: 10 });

      const updated = await harness.driver.transaction(async () => {
        return Ledger.findOneAndUpdate({ key: "acct" }, { $inc: { amount: 5 } });
      });

      expect(updated).not.toBeNull();
      expect(updated!.get("amount")).toBe(15);

      const set = await harness.driver.transaction(async () => {
        return Ledger.findOneAndUpdate({ key: "acct" }, { $set: { amount: 99 } });
      });
      expect(set!.get("amount")).toBe(99);
    });
  });
});

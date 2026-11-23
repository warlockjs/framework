import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Model } from "../../../src/model/model";
import {
  hasLocalPostgres,
  startLocalPostgresHarness,
  type LocalPostgresHarness,
} from "../helpers/local-postgres-harness";

/**
 * Live checks for full-text options, `whereContains` and full-text index
 * weights on a real PostgreSQL. Touches only the `local_live564_*` table.
 * Skipped when LOCAL_PG_* is not configured.
 */

const suite = hasLocalPostgres() ? describe : describe.skip;

const SHIPMENTS = "local_live564_shipments";

class Shipment extends Model {
  public static table = SHIPMENTS;
}

suite("Postgres live: 5.64 full-text options and whereContains", () => {
  let harness: LocalPostgresHarness;

  beforeAll(async () => {
    harness = await startLocalPostgresHarness();
    await harness.dropTables(SHIPMENTS);
    await harness.query(
      `CREATE TABLE "${SHIPMENTS}" (id SERIAL PRIMARY KEY, title TEXT, body TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`,
    );
    await harness.query(
      `INSERT INTO "${SHIPMENTS}" (title, body) VALUES ($1, $2), ($3, $4), ($5, $6)`,
      [
        "شحنة الرمان الخامسة",
        "تصل غدا",
        "50% off_sale",
        "a literal percent and underscore",
        "Weekly shipping report",
        "shipments leave on Monday",
      ],
    );
  });

  afterAll(async () => {
    await harness.dropTables(SHIPMENTS);
    await harness.stop();
  });

  it("finds a partial Arabic word with whereContains", async () => {
    const rows = await Shipment.query().whereContains("title", "رمان").get();

    expect(rows.map((row) => row.get("title"))).toEqual(["شحنة الرمان الخامسة"]);
  });

  it("treats % and _ as literal characters in whereContains", async () => {
    expect(await Shipment.query().whereContains("title", "50% off_").count()).toBe(1);
    expect(await Shipment.query().whereContains("title", "5_%").count()).toBe(0);
  });

  it("matches a whole Arabic word with whereSearch and the simple configuration", async () => {
    const simple = await Shipment.query()
      .whereSearch("title", "الخامسة", { language: "simple" })
      .count();

    expect(simple).toBe(1);
  });

  it("ORs orWhereFullText with the language given", async () => {
    const rows = await Shipment.query()
      .whereFullText(["title"], "shipping")
      .orWhereFullText(["title", "body"], "الرمان", { language: "simple", weights: { body: "B" } })
      .get();

    expect(rows.map((row) => row.get("title")).sort()).toEqual(
      ["Weekly shipping report", "شحنة الرمان الخامسة"].sort(),
    );
  });

  it("creates a full-text index with weight letters, and refuses a number", async () => {
    const migration = harness.driver.migrationDriver();

    await migration.createFullTextIndex(SHIPMENTS, ["title", "body"], {
      name: "local_live564_ft",
      language: "simple",
      weights: { title: "A", body: "C" },
    });

    const index = await harness.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'local_live564_ft'`,
    );

    expect(JSON.stringify(index)).toContain("'C'");

    await expect(
      migration.createFullTextIndex(SHIPMENTS, ["title"], {
        name: "local_live564_ft_bad",
        weights: { title: 5 },
      }),
    ).rejects.toThrow(/letters "A"/);
  });
});

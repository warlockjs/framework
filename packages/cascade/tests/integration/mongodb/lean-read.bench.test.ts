import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Model } from "../../../src/model/model";
import {
  hasLocalMongodb,
  startLocalMongodbHarness,
  type LocalMongodbHarness,
} from "../helpers/local-mongodb-harness";

/**
 * Benchmark: hydrated vs lean reads of 10,000 documents on a REAL mongod.
 *
 * Opt-in (it is a measurement, not a check): runs only when CASCADE_BENCH=1 and
 * LOCAL_MONGO_* are set. Prints median wall-clock per read over ROUNDS
 * alternating rounds after a warm-up of each mode.
 */

const enabled = hasLocalMongodb() && process.env.CASCADE_BENCH === "1";
const suite = enabled ? describe : describe.skip;

const COLLECTION = "lean_bench_rows";
const ROW_COUNT = 10_000;
const ROUNDS = 7;

class BenchRow extends Model {
  public static table = COLLECTION;
  public static hidden = ["secret"];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function time(read: () => Promise<unknown[]>): Promise<number> {
  const start = performance.now();
  const rows = await read();
  const elapsed = performance.now() - start;

  expect(rows).toHaveLength(ROW_COUNT);

  return elapsed;
}

suite("benchmark — hydrated vs lean (MongoDB, 10k rows)", () => {
  let harness: LocalMongodbHarness;

  beforeAll(async () => {
    harness = await startLocalMongodbHarness();
    await harness.dropCollections(COLLECTION);

    const now = new Date();
    const docs = Array.from({ length: ROW_COUNT }, (_, index) => ({
      id: index + 1,
      name: `row ${index + 1}`,
      email: `row${index + 1}@example.com`,
      score: index % 100,
      isActive: index % 2 === 0,
      tags: ["a", "b", "c"],
      createdAt: now,
      secret: "hash",
    }));

    await harness.db.collection(COLLECTION).insertMany(docs);
  }, 300_000);

  afterAll(async () => {
    await harness.dropCollections(COLLECTION);
    await harness.stop();
  });

  it("measures both modes", async () => {
    const hydrated = () => BenchRow.query().get();
    const lean = () => BenchRow.query().lean().get();

    await time(hydrated);
    await time(lean);

    const hydratedTimes: number[] = [];
    const leanTimes: number[] = [];

    for (let round = 0; round < ROUNDS; round++) {
      hydratedTimes.push(await time(hydrated));
      leanTimes.push(await time(lean));
    }

    const hydratedMedian = median(hydratedTimes);
    const leanMedian = median(leanTimes);

    process.stdout.write(
      `\n[lean bench] rows=${ROW_COUNT} rounds=${ROUNDS}\n` +
        `  hydrated median ${hydratedMedian.toFixed(1)} ms  (${hydratedTimes.map((t) => t.toFixed(0)).join(", ")})\n` +
        `  lean     median ${leanMedian.toFixed(1)} ms  (${leanTimes.map((t) => t.toFixed(0)).join(", ")})\n` +
        `  speed-up ${(hydratedMedian / leanMedian).toFixed(2)}x\n`,
    );
  }, 300_000);
});

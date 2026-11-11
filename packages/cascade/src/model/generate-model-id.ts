import type { IdGeneratorContract } from "../contracts/database-id-generator.contract";
import type { ChildModel, Model } from "./model";

/**
 * Ids reserved ahead by `idReservationBlockSize`, per id generator and table.
 * Each entry keeps the ids not handed out yet and the refill in flight, so
 * concurrent inserts share one counter round-trip.
 */
const reservedIds = new WeakMap<object, Map<string, { ids: number[]; refill?: Promise<void> }>>();

/**
 * Hand out the next id from the table's reserved block, reserving a new
 * block of `blockSize` ids in one counter round-trip when it is empty.
 */
async function takeReservedId(
  idGenerator: IdGeneratorContract,
  table: string,
  initialId: number,
  incrementIdBy: number,
  blockSize: number,
): Promise<number> {
  let tables = reservedIds.get(idGenerator);

  if (!tables) {
    tables = new Map();
    reservedIds.set(idGenerator, tables);
  }

  let block = tables.get(table);

  if (!block) {
    block = { ids: [] };
    tables.set(table, block);
  }

  const reserved = block;

  while (reserved.ids.length === 0) {
    if (!reserved.refill) {
      reserved.refill = idGenerator.generateNextIds!({
        table,
        initialId,
        incrementIdBy,
        count: blockSize,
      })
        .then((ids) => {
          if (ids.length === 0) {
            throw new Error(
              `The id generator reserved no ids for "${table}". Check the data source's id generator, or remove idReservationBlockSize from the model.`,
            );
          }

          reserved.ids.push(...ids);
        })
        .finally(() => {
          reserved.refill = undefined;
        });
    }

    await reserved.refill;
  }

  return reserved.ids.shift() as number;
}

/**
 * Generate the next model id using the model's configured sequence options.
 *
 * This is shared by normal inserts and MongoDB upserts so both write paths
 * resolve random and configured sequence settings identically.
 *
 * With `idReservationBlockSize` above 1 (opt-in), ids come from a block
 * reserved in one counter round-trip instead of one round-trip per id.
 */
export async function generateModelId<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
): Promise<number | undefined> {
  const idGenerator = ModelClass.getDataSource().idGenerator;

  if (!idGenerator) {
    return undefined;
  }

  const blockSize = Math.floor(ModelClass.idReservationBlockSize ?? 1);

  if (
    blockSize > 1 &&
    !ModelClass.randomInitialId &&
    !ModelClass.randomIncrement &&
    typeof idGenerator.generateNextIds === "function"
  ) {
    return await takeReservedId(
      idGenerator,
      ModelClass.table,
      ModelClass.initialId || 1,
      ModelClass.incrementIdBy || 1,
      blockSize,
    );
  }

  const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
  const initialId = ModelClass.initialId
    ? ModelClass.initialId
    : ModelClass.randomInitialId
      ? typeof ModelClass.randomInitialId === "function"
        ? ModelClass.randomInitialId()
        : randomInt(10000, 499999)
      : 1;
  const incrementIdBy = ModelClass.randomIncrement
    ? typeof ModelClass.randomIncrement === "function"
      ? ModelClass.randomIncrement()
      : randomInt(1, 10)
    : ModelClass.incrementIdBy || 1;

  return await idGenerator.generateNextId({
    table: ModelClass.table,
    initialId,
    incrementIdBy,
  });
}

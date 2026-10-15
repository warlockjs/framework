import type { ChildModel, Model } from "./model";

/**
 * Generate the next model id using the model's configured sequence options.
 *
 * This is shared by normal inserts and MongoDB upserts so both write paths
 * resolve random and configured sequence settings identically.
 */
export async function generateModelId<TModel extends Model>(
  ModelClass: ChildModel<TModel>,
): Promise<number | undefined> {
  const idGenerator = ModelClass.getDataSource().idGenerator;

  if (!idGenerator) {
    return undefined;
  }

  const randomInt = (min: number, max: number) =>
    Math.floor(Math.random() * (max - min + 1)) + min;
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

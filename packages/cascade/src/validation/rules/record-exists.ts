import type { QueryBuilderContract } from "../../contracts";
import { hasStaticEventListeners } from "../../model/methods/static-event-methods";

/**
 * Whether the rule's query matches a row.
 *
 * Asks the database a yes/no question (`exists()`) instead of fetching and
 * hydrating a whole model. When the model has a `fetching`, `hydrating` or
 * `fetched` listener, the query still runs through `first()`: those listeners
 * see (and may change) every model fetch, the rule's lookup included.
 */
export async function recordExists(
  ModelClass: unknown,
  query: QueryBuilderContract<any>,
): Promise<boolean> {
  if (hasStaticEventListeners(ModelClass, ["fetching", "hydrating", "fetched"])) {
    return (await query.first()) ? true : false;
  }

  return await query.exists();
}

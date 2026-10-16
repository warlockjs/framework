/**
 * Map `items` through an async `mapper`, running at most `limit` mappers
 * at a time, and resolve with the results in input order. A new mapper
 * starts as soon as a running one settles. Rejects with the first
 * mapper rejection (like `Promise.all`); mappers already started are not
 * cancelled.
 *
 * @example
 * const pages = await mapWithConcurrency(urls, 4, (url) => fetch(url));
 */
export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  limit: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  const workerCount = Math.max(1, Math.min(Math.floor(limit), items.length));
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;

      results[index] = await mapper(items[index] as TItem, index);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

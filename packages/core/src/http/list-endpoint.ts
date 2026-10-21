import type { PaginationResult, RepositoryOptions } from "../repositories/contracts";
import type { Request } from "./request";
import { AppError } from "./errors";

export type ListQuery = {
  page?: number;
  limit?: number;
  orderBy?: string;
  orderDir?: "asc" | "desc";
};

export type ListEndpointOptions<Key extends string, Query extends ListQuery> = {
  pluralKey: Key & (Key extends "pagination" ? never : unknown);
  /** Indexed columns clients may sort on. */
  orderBy: readonly string[];
  /** Only these validated query fields reach repository filters. */
  filters?: readonly Exclude<keyof Query & string, keyof ListQuery>[];
  defaultLimit?: number;
  maxLimit?: number;
};

export type ListEndpointRepositoryOptions<Query extends ListQuery> = RepositoryOptions &
  Partial<Omit<Query, keyof ListQuery>> & {
    page: number;
    limit: number;
    paginate: true;
    paginationMode: "pages";
  };

export type ListEndpointBody<Key extends string, Item> = Record<Key, Item[]> & {
  pagination: PaginationResult<Item>["pagination"];
};

/** Build a bounded, page-based list body from validated query values only. */
export function listEndpoint<Key extends string, Query extends ListQuery, Item>(
  request: Request<Query>,
  list: (options: ListEndpointRepositoryOptions<Query>) => Promise<PaginationResult<Item>>,
  options: ListEndpointOptions<Key, Query>,
): Promise<ListEndpointBody<Key, Item>>;
export function listEndpoint<Key extends string, Query extends ListQuery, Item>(
  request: { validated(): Query },
  list: (options: ListEndpointRepositoryOptions<Query>) => Promise<PaginationResult<Item>>,
  options: ListEndpointOptions<Key, Query>,
): Promise<ListEndpointBody<Key, Item>>;
export async function listEndpoint<Key extends string, Query extends ListQuery, Item>(
  request: { validated(): Query },
  list: (options: ListEndpointRepositoryOptions<Query>) => Promise<PaginationResult<Item>>,
  options: ListEndpointOptions<Key, Query>,
): Promise<ListEndpointBody<Key, Item>> {
  const maxLimit = options.maxLimit ?? 100;
  const defaultLimit = options.defaultLimit ?? 20;
  if (
    !Number.isSafeInteger(maxLimit) ||
    maxLimit < 1 ||
    !Number.isSafeInteger(defaultLimit) ||
    defaultLimit < 1 ||
    options.pluralKey === "pagination" ||
    !options.pluralKey
  ) {
    throw new TypeError("Invalid listEndpoint configuration.");
  }
  const query = request.validated();
  const page = query.page ?? 1;
  const requestedLimit = query.limit ?? defaultLimit;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(requestedLimit) ||
    requestedLimit < 1 ||
    (query.orderBy !== undefined && !options.orderBy.includes(query.orderBy)) ||
    (query.orderDir !== undefined && query.orderDir !== "asc" && query.orderDir !== "desc")
  ) {
    throw new AppError("invalidListQuery", 422, "Invalid list query.");
  }
  const filters = Object.fromEntries(
    (options.filters ?? [])
      .filter((key) => query[key] !== undefined)
      .map((key) => [key, query[key]]),
  ) as Partial<Omit<Query, keyof ListQuery>>;
  const result = await list({
    ...filters,
    page,
    limit: Math.min(requestedLimit, maxLimit),
    paginate: true,
    paginationMode: "pages",
    ...(query.orderBy === undefined
      ? {}
      : {
          orderBy: [query.orderBy, query.orderDir ?? "asc"] as [string, "asc" | "desc"],
        }),
  });
  return { [options.pluralKey]: result.data, pagination: result.pagination } as Record<
    Key,
    Item[]
  > & { pagination: PaginationResult<Item>["pagination"] };
}

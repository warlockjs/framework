import { ChunkCallback, CursorPaginationOptions, CursorPaginationResult, FilterOptions, FilterRules, PaginationResult, WhereOperator } from "../../contracts/types.mjs";
import { QueryBuilderContract as QueryBuilderContract$1 } from "../../contracts/query-builder.contract.mjs";
import { Model, QueryBuilderContract } from "@warlock.js/cascade";

//#region ../../@warlock.js/core/src/repositories/adapters/cascade/cascade-query-builder.d.ts
/**
 * Cascade query builder wrapper
 * Wraps Cascade-Next's ModelAggregate to implement QueryBuilderContract
 *
 * @template T - The model instance type
 */
declare class CascadeQueryBuilder<T extends Model> implements QueryBuilderContract$1<T> {
  private query;
  /**
   * Constructor
   * @param query - Cascade-Next QueryBuilder instance
   */
  constructor(query: QueryBuilderContract<T>);
  /**
   * {@inheritDoc QueryBuilderContract.where}
   */
  where(field: string, value: any): this;
  where(field: string, operator: WhereOperator, value: any): this;
  where(conditions: Record<string, any>): this;
  where(callback: (query: this) => void): this;
  /**
   * Pretty display the query in terminal
   */
  pretty(): any;
  /**
   * {@inheritDoc QueryBuilderContract.orWhere}
   */
  orWhere(field: string, value: any): this;
  orWhere(field: string, operator: WhereOperator, value: any): this;
  orWhere(conditions: Record<string, any>): this;
  /**
   * {@inheritDoc QueryBuilderContract.whereIn}
   */
  whereIn(field: string, values: any[]): this;
  /**
   * {@inheritDoc QueryBuilderContract.whereNotIn}
   */
  whereNotIn(field: string, values: any[]): this;
  /**
   * {@inheritDoc QueryBuilderContract.whereNull}
   */
  whereNull(field: string): this;
  /**
   * {@inheritDoc QueryBuilderContract.whereNotNull}
   */
  whereNotNull(field: string): this;
  /**
   * {@inheritDoc QueryBuilderContract.whereBetween}
   */
  whereBetween(field: string, range: [any, any]): this;
  /**
   * {@inheritDoc QueryBuilderContract.whereLike}
   */
  whereLike(field: string, pattern: string): this;
  /**
   * {@inheritDoc QueryBuilderContract.similarTo}
   */
  similarTo(column: string, embedding: number[], alias?: string): this;
  /**
   * {@inheritDoc QueryBuilderContract.select}
   */
  select(fields: string[]): this;
  select(...fields: string[]): this;
  /**
   * {@inheritDoc QueryBuilderContract.deselect}
   */
  deselect(fields: string[]): this;
  deselect(...fields: string[]): this;
  /**
   * {@inheritDoc QueryBuilderContract.orderBy}
   */
  orderBy(field: string, direction?: "asc" | "desc"): this;
  /**
   * {@inheritDoc QueryBuilderContract.sortBy}
   */
  sortBy(orderBy: Record<string, "asc" | "desc">): this;
  /**
   * {@inheritDoc QueryBuilderContract.random}
   */
  random(limit: number): this;
  /**
   * {@inheritDoc QueryBuilderContract.limit}
   */
  limit(limit: number): this;
  /**
   * {@inheritDoc QueryBuilderContract.offset}
   */
  offset(offset: number): this;
  /**
   * {@inheritDoc QueryBuilderContract.skip}
   */
  skip(count: number): this;
  /**
   * {@inheritDoc QueryBuilderContract.applyFilters}
   */
  applyFilters(filters: FilterRules<this>, data: any, options: FilterOptions): this;
  /**
   * {@inheritDoc QueryBuilderContract.get}
   */
  get(): Promise<T[]>;
  /**
   * {@inheritDoc QueryBuilderContract.first}
   */
  first(): Promise<T | null>;
  /**
   * {@inheritDoc QueryBuilderContract.count}
   */
  count(): Promise<number>;
  /**
   * {@inheritDoc QueryBuilderContract.paginate}
   */
  paginate(page: number, limit: number): Promise<PaginationResult<T>>;
  /**
   * {@inheritDoc QueryBuilderContract.cursorPaginate}
   *
   * NOTE: This method is a pure executor.
   * The caller (e.g. RepositoryManager._listImpl) is responsible for applying
   * the cursor WHERE condition and ORDER BY BEFORE calling this method,
   * so that the cursor column is always the primary sort key.
   */
  cursorPaginate(options: CursorPaginationOptions): Promise<CursorPaginationResult<T>>;
  /**
   * {@inheritDoc QueryBuilderContract.chunk}
   */
  chunk(size: number, callback: ChunkCallback<T>): Promise<void>;
  /**
   * {@inheritDoc QueryBuilderContract.with}
   */
  with(relation: string): this;
  /**
   * {@inheritDoc QueryBuilderContract.joinWith}
   */
  joinWith(...relations: string[]): this;
  /**
   * {@inheritDoc QueryBuilderContract.clone}
   */
  clone(): this;
}
//#endregion
export { CascadeQueryBuilder };
//# sourceMappingURL=cascade-query-builder.d.mts.map
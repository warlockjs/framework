import { RepositoryAdapterContract } from "../../contracts/repository-adapter.contract.mjs";
import { ChunkCallback, CursorPaginationOptions, CursorPaginationResult, PaginationResult } from "../../contracts/types.mjs";
import { QueryBuilderContract as QueryBuilderContract$1 } from "../../contracts/query-builder.contract.mjs";
import { ChildModel, Model } from "@warlock.js/cascade";

//#region ../../@warlock.js/core/src/repositories/adapters/cascade/cascade-adapter.d.ts
/**
 * Cascade adapter for Cascade-Next ORM
 * Implements RepositoryAdapterContract for @warlock.js/cascade
 *
 * @template T - The model instance type
 */
declare class CascadeAdapter<T extends Model<any>> implements RepositoryAdapterContract<T> {
  private model;
  /**
   * Constructor
   * @param model - Cascade-Next Model class
   */
  constructor(model: ChildModel<T>);
  /**
   * {@inheritDoc RepositoryAdapterContract.query}
   */
  query(): QueryBuilderContract$1<T>;
  /**
   * Register all events
   */
  registerEvents(eventsCallback: any): any[];
  /**
   * {@inheritDoc RepositoryAdapterContract.find}
   */
  find(id: any): Promise<T | null>;
  /**
   * {@inheritDoc RepositoryAdapterContract.findBy}
   */
  findBy(column: string, value: any): Promise<T | null>;
  /**
   * {@inheritDoc RepositoryAdapterContract.serializeModel}
   */
  serializeModel(model: T): any;
  /**
   * {@inheritDoc RepositoryAdapterContract.deserializeModel}
   */
  deserializeModel(data: any): T;
  /**
   * {@inheritDoc RepositoryAdapterContract.resolveRepositoryName}
   */
  resolveRepositoryName(): string;
  /**
   * {@inheritDoc RepositoryAdapterContract.create}
   */
  create(data: any): Promise<T>;
  /**
   * {@inheritDoc RepositoryAdapterContract.update}
   */
  update(id: any, data: any): Promise<T>;
  /**
   * {@inheritDoc RepositoryAdapterContract.delete}
   */
  delete(id: any): Promise<void>;
  /**
   * {@inheritDoc RepositoryAdapterContract.updateMany}
   */
  updateMany(filter: any, data: any): Promise<number>;
  /**
   * {@inheritDoc RepositoryAdapterContract.deleteMany}
   */
  deleteMany(filter: any): Promise<number>;
  /**
   * {@inheritDoc RepositoryAdapterContract.count}
   */
  count(filter?: any): Promise<number>;
  /**
   * {@inheritDoc RepositoryAdapterContract.paginate}
   */
  paginate(page: number, limit: number): Promise<PaginationResult<T>>;
  /**
   * {@inheritDoc RepositoryAdapterContract.cursorPaginate}
   */
  cursorPaginate(options: CursorPaginationOptions): Promise<CursorPaginationResult<T>>;
  /**
   * {@inheritDoc RepositoryAdapterContract.chunk}
   */
  chunk(size: number, callback: ChunkCallback<T>): Promise<void>;
  /**
   * {@inheritDoc RepositoryAdapterContract.createModel}
   */
  createModel(data: any): T;
}
//#endregion
export { CascadeAdapter };
//# sourceMappingURL=cascade-adapter.d.mts.map
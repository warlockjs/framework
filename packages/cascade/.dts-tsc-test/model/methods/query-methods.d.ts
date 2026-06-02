import type { PaginationOptions, PaginationResult, QueryBuilderContract, UpdateOperations } from "../../contracts";
import type { DataSource } from "../../data-source/data-source";
import type { ChildModel, Model } from "../model";
export declare function buildQuery<TModel extends Model>(ModelClass: ChildModel<TModel>, BaseModel: typeof Model): QueryBuilderContract<TModel>;
export declare function buildNewQueryBuilder<TModel extends Model>(ModelClass: ChildModel<TModel>): QueryBuilderContract<TModel>;
export declare function findFirst<TModel extends Model>(ModelClass: ChildModel<TModel>, filter?: Record<string, unknown>): Promise<TModel | null>;
export declare function findLast<TModel extends Model>(ModelClass: ChildModel<TModel>, filter?: Record<string, unknown>): Promise<TModel | null>;
export declare function findAll<TModel extends Model>(ModelClass: ChildModel<TModel>, filter?: Record<string, unknown>): Promise<TModel[]>;
export declare function countRecords<TModel extends Model>(ModelClass: ChildModel<TModel>, filter?: Record<string, unknown>): Promise<number>;
export declare function findById<TModel extends Model>(ModelClass: ChildModel<TModel>, id: string | number): Promise<TModel | null>;
export declare function paginateRecords<TModel extends Model>(ModelClass: ChildModel<TModel>, options?: PaginationOptions & {
    filter?: Record<string, unknown>;
}): Promise<PaginationResult<TModel>>;
export declare function findLatest<TModel extends Model>(ModelClass: ChildModel<TModel>, filter?: Record<string, unknown>): Promise<TModel[]>;
export declare function increaseField<TModel extends Model>(ModelClass: ChildModel<TModel>, filter: Record<string, unknown>, field: string, amount: number): Promise<number>;
export declare function decreaseField<TModel extends Model>(ModelClass: ChildModel<TModel>, filter: Record<string, unknown>, field: string, amount: number): Promise<number>;
export declare function performAtomic<TModel extends Model>(ModelClass: ChildModel<TModel>, filter: Record<string, unknown>, operations: UpdateOperations): Promise<number>;
export declare function updateById<TModel extends Model>(ModelClass: ChildModel<TModel>, id: string | number, data: Record<string, unknown>): Promise<number>;
export declare function findAndUpdateRecords<TModel extends Model>(ModelClass: ChildModel<TModel>, filter: Record<string, unknown>, update: UpdateOperations): Promise<TModel[]>;
export declare function findOneAndUpdateRecord<TModel extends Model>(ModelClass: ChildModel<TModel>, filter: Record<string, unknown>, update: UpdateOperations): Promise<TModel | null>;
export declare function findAndReplaceRecord<TModel extends Model>(ModelClass: ChildModel<TModel>, filter: Record<string, unknown>, document: Record<string, unknown>): Promise<TModel | null>;
export declare function findOneAndDeleteRecord<TModel extends Model>(ModelClass: ChildModel<TModel>, filter: Record<string, unknown>, options?: Record<string, unknown>): Promise<TModel | null>;
export declare function resolveDataSource<TModel extends Model>(ModelClass: ChildModel<TModel>): DataSource;
//# sourceMappingURL=query-methods.d.ts.map
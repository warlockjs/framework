import type { WriterOptions } from "../../contracts";
import type { ChildModel, Model, ModelSchema } from "../model";
export declare function saveModel<TModel extends Model>(model: TModel, options?: WriterOptions & {
    merge?: Partial<ModelSchema>;
}): Promise<TModel>;
export declare function createRecord<TModel extends Model, TSchema extends ModelSchema = TModel extends Model<infer S> ? S : ModelSchema>(ModelClass: ChildModel<TModel>, data: Partial<TSchema>): Promise<TModel>;
export declare function createManyRecords<TModel extends Model, TSchema extends ModelSchema = TModel extends Model<infer S> ? S : ModelSchema>(ModelClass: ChildModel<TModel>, data: Partial<TSchema>[]): Promise<TModel[]>;
export declare function findOrCreateRecord<TModel extends Model, TSchema extends ModelSchema = TModel extends Model<infer S> ? S : ModelSchema>(ModelClass: ChildModel<TModel>, filter: Partial<TSchema>, data: Partial<TSchema>): Promise<TModel>;
export declare function upsertRecord<TModel extends Model, TSchema extends ModelSchema = TModel extends Model<infer S> ? S : ModelSchema>(ModelClass: ChildModel<TModel>, filter: Partial<TSchema>, data: Partial<TSchema>, options?: Record<string, unknown>): Promise<TModel>;
//# sourceMappingURL=write-methods.d.ts.map
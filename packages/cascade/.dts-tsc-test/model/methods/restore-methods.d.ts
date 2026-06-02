import type { ChildModel, Model } from "../model";
export declare function restoreRecord<TModel extends Model>(ModelClass: ChildModel<TModel>, id: string | number, options?: {
    onIdConflict?: "fail" | "assignNew";
    skipEvents?: boolean;
}): Promise<TModel>;
export declare function restoreAllRecords<TModel extends Model>(ModelClass: ChildModel<TModel>, options?: {
    onIdConflict?: "fail" | "assignNew";
    skipEvents?: boolean;
}): Promise<TModel[]>;
//# sourceMappingURL=restore-methods.d.ts.map
import type { DeleteStrategy } from "../../types";
import type { RemoverResult } from "../../contracts";
import type { ChildModel, Model } from "../model";
export declare function destroyModel(model: Model, options?: {
    strategy?: DeleteStrategy;
    skipEvents?: boolean;
}): Promise<RemoverResult>;
export declare function deleteRecords(ModelClass: ChildModel<any>, filter?: Record<string, unknown>): Promise<number>;
export declare function deleteOneRecord(ModelClass: ChildModel<any>, filter?: Record<string, unknown>): Promise<number>;
//# sourceMappingURL=delete-methods.d.ts.map
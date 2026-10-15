import { type ModelSnapshot } from "../../relations/relation-hydrator";
import type { ChildModel, Model } from "../model";
export declare function hydrateModel<TModel extends Model = Model>(ModelClass: ChildModel<TModel>, data: Record<string, unknown>): TModel;
export declare function modelFromSnapshot<TModel extends Model>(ModelClass: ChildModel<TModel>, snapshot: ModelSnapshot): TModel;
export declare function modelToSnapshot(model: Model): ModelSnapshot;
export declare function serializeModel(model: Model): Record<string, unknown>;
export declare function cloneModel<TModel extends Model>(model: TModel): TModel;
export declare function deepFreezeObject<T>(obj: T): T;
export declare function replaceModelData<TModel extends Model>(model: TModel, data: Record<string, unknown>): void;
//# sourceMappingURL=hydration-methods.d.ts.map
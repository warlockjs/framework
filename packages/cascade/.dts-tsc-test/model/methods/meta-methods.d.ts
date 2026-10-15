import type { Model } from "../model";
export declare function applyDefaultsToModel(ModelClass: any, defaults: any): void;
export declare function generateModelNextId(model: Model): Promise<number | string>;
export declare function performAtomicUpdate(model: Model, operations: Record<string, unknown>): Promise<number>;
export declare function performAtomicIncrement<T extends string>(model: Model, field: T, amount?: number): Promise<number>;
export declare function performAtomicDecrement<T extends string>(model: Model, field: T, amount?: number): Promise<number>;
//# sourceMappingURL=meta-methods.d.ts.map
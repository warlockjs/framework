import type { Model } from "../model";
export declare function checkHasChanges(model: Model): boolean;
export declare function checkIsDirty(model: Model, column: string): boolean;
export declare function getDirtyColumnsWithValues(model: Model): Record<string, {
    oldValue: unknown;
    newValue: unknown;
}>;
export declare function getRemovedColumns(model: Model): string[];
export declare function getDirtyColumns(model: Model): string[];
//# sourceMappingURL=dirty-methods.d.ts.map
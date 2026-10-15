import type { Model } from "../model";
export declare function getFieldValue(model: Model, field: string, defaultValue?: unknown): any;
export declare function setFieldValue(model: Model, field: string, value: unknown): Model;
export declare function hasField(model: Model, field: string): boolean;
export declare function incrementField(model: Model, field: string, amount?: number): Model;
export declare function decrementField(model: Model, field: string, amount?: number): Model;
export declare function unsetFields(model: Model, ...fields: string[]): Model;
export declare function mergeFields(model: Model, values: Record<string, unknown>): Model;
export declare function getOnlyFields(model: Model, fields: string[]): Record<string, unknown>;
export declare function getStringField(model: Model, key: string, defaultValue?: string): string | undefined;
export declare function getNumberField(model: Model, key: string, defaultValue?: number): number | undefined;
export declare function getBooleanField(model: Model, key: string, defaultValue?: boolean): boolean | undefined;
//# sourceMappingURL=accessor-methods.d.ts.map
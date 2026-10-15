import { type Model } from "../model/model";
type transformCallbackOptions = {
    model: Model;
    column: string;
    value: any;
    isChanged: boolean;
    isNew: boolean;
};
export type ModelTransformCallback = (options: transformCallbackOptions) => string;
/**
 * Transfer value before saving it into the database
 */
export declare function useModelTransformer(callback: ModelTransformCallback): TransformerCallback;
export {};
//# sourceMappingURL=database-writer.utils.d.ts.map
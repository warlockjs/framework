import { Model } from "../model/model.mjs";

//#region ../../@warlock.js/cascade/src/utils/database-writer.utils.d.ts
type transformCallbackOptions = {
  model: Model;
  column: string;
  value: any;
  isChanged: boolean;
  isNew: boolean;
};
type ModelTransformCallback = (options: transformCallbackOptions) => string;
/**
 * Transfer value before saving it into the database
 */
declare function useModelTransformer(callback: ModelTransformCallback): TransformerCallback;
//#endregion
export { ModelTransformCallback, useModelTransformer };
//# sourceMappingURL=database-writer.utils.d.mts.map
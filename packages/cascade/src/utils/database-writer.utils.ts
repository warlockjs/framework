import { type TransformerCallback } from "@warlock.js/seal";
import { type Model } from "../model/model";

type transformCallbackOptions = {
  model: Model;
  column: string;
  value: any;
  isChanged: boolean;
  isNew: boolean;
};

export type ModelTransformCallback = (options: transformCallbackOptions) => unknown | Promise<unknown>;

/**
 * Transfer value before saving it into the database
 */
export function useModelTransformer(callback: ModelTransformCallback) {
  const transformCallback: TransformerCallback = (data, { context }) => {
    const model = context.rootContext?.model as Model | undefined;

    // No model (e.g. the schema is reused to validate a request body): nothing to transform
    if (!model) return data;

    const column = context.key;
    const value = data;
    const isChanged = model.isDirty(column);
    const isNew = model.isNew;
    return callback({ model, column, value, isChanged, isNew });
  };

  return transformCallback;
}

import type { StandardSchemaV1 } from "./standard-schema/types";
import type { Schema } from "./types";
import type { Infer } from "./types/inference-types";
import { ObjectValidator } from "./validators/object-validator";

// Keep both runtime chain methods and their declaration augmentations in
// this standalone entry, without loading the complete validator factory.
export { equalityConditionalMethodsApplied } from "./validators/methods/equality-conditional-methods";
export { forbiddenMethodsApplied } from "./validators/methods/forbidden-methods";
export { presentMethodsApplied } from "./validators/methods/present-methods";
export { requiredMethodsApplied } from "./validators/methods/required-methods";
export { ObjectValidator };

/** Create an object schema without importing the complete `v` factory. */
export const object = <T extends Schema>(schema: T, errorMessage?: string) =>
  new ObjectValidator<T>(schema, errorMessage) as ObjectValidator<T> &
    StandardSchemaV1<Infer<ObjectValidator<T>>>;

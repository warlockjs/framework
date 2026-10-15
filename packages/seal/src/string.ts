import type { StandardSchemaV1 } from "./standard-schema/types";
import { StringValidator } from "./validators/string-validator";

export { equalityConditionalMethodsApplied } from "./validators/methods/equality-conditional-methods";
export { forbiddenMethodsApplied } from "./validators/methods/forbidden-methods";
export { presentMethodsApplied } from "./validators/methods/present-methods";
export { requiredMethodsApplied } from "./validators/methods/required-methods";
export { StringValidator };

/** Create a string schema without importing the complete `v` factory. */
export const string = (errorMessage?: string) =>
  new StringValidator(errorMessage) as StringValidator & StandardSchemaV1<string>;

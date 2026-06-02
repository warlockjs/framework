import { HttpError } from "../http/errors/errors.mjs";
import { ValidationResult } from "@warlock.js/seal";

//#region ../../@warlock.js/core/src/use-cases/use-case.errors.d.ts
declare class BadSchemaUseCaseError extends HttpError {
  constructor(result: ValidationResult);
}
//#endregion
export { BadSchemaUseCaseError };
//# sourceMappingURL=use-case.errors.d.mts.map
import { HttpError } from "../http/errors/errors.mjs";
//#region ../../@warlock.js/core/src/use-cases/use-case.errors.ts
var BadSchemaUseCaseError = class extends HttpError {
	constructor(result) {
		super(400, `Invalid input data`, {
			code: "BAD_SCHEMA_USE_CASE",
			errors: result.errors
		});
	}
};
//#endregion
export { BadSchemaUseCaseError };

//# sourceMappingURL=use-case.errors.mjs.map
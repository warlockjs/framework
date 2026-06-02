import { v } from "@warlock.js/seal";
import baseConfig from "@mongez/config";
import { log } from "@warlock.js/logger";
import { merge } from "@mongez/reinforcements";
//#region ../../@warlock.js/core/src/validation/validateAll.ts
function resolveDataToParse(validating, request) {
	if (!validating || validating.length === 0) return request.allExceptParams();
	let data = {};
	for (const validatingType of validating) {
		if (validatingType === "body") data = merge(data, request.body);
		if (validatingType === "query") data = merge(data, request.query);
		if (validatingType === "params") data = merge(data, request.params);
		if (validatingType === "headers") data = merge(data, request.headers);
	}
	return data;
}
/**
* Validate the request route
*/
async function validateAll(validation, request, response) {
	if (!validation) return;
	log.info("validation", "started", "Start validating the request");
	if (validation.schema) {
		log.info("validation", "schema", "Validating request schema");
		try {
			const data = resolveDataToParse(validation.validating, request);
			const result = await v.validate(validation.schema, data);
			if (result.data && result.isValid) request.setValidatedData(result.data);
			if (!result.isValid) {
				log.warn("validation", "schema", "Schema Validation failed");
				return response.failedSchema(result);
			}
			log.success("validation", "schema", "Schema Validation passed");
		} catch (error) {
			log.warn("app.validation", "error", error);
			throw error;
		}
	}
	if (validation.validate) {
		const result = await validation.validate(request, response);
		if (result) {
			if (!response.statusCode) response.setStatusCode(baseConfig.get("validation.responseStatus", 400));
			log.info("validation", "failed", "Validation failed");
			return result;
		}
		log.info("validation", "passed", "Validation passed");
	}
}
//#endregion
export { validateAll };

//# sourceMappingURL=validateAll.mjs.map
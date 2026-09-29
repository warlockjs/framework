import config from "@mongez/config";
import { merge } from "@mongez/reinforcements";
import { log } from "@warlock.js/logger";
import { v } from "@warlock.js/seal";
import type { Request } from "../http";
import { Response } from "../http/response";
import type { RequestHandlerValidation, Route } from "../router";

function resolveDataToParse(
  validating: RequestHandlerValidation["validating"],
  schema: RequestHandlerValidation["schema"],
  request: Request,
) {
  if (!validating || validating.length === 0) {
    const data = request.allExceptParams();

    // Duck-typed rather than `instanceof ObjectValidator`: the app's schema can
    // come from a different copy of seal than core's, and `instanceof` would
    // then silently fall back to ignoring params.
    const shape = (schema as { schema?: unknown } | undefined)?.schema;

    if (!shape || typeof shape !== "object") return data;

    for (const [key, value] of Object.entries(request.params)) {
      if (data[key] === undefined && Object.hasOwn(shape, key)) {
        data[key] = value;
      }
    }

    return data;
  }

  let data: any = {};

  for (const validatingType of validating) {
    if (validatingType === "body") {
      data = merge(data, request.body);
    }

    if (validatingType === "query") {
      data = merge(data, request.query);
    }

    if (validatingType === "params") {
      data = merge(data, request.params);
    }

    if (validatingType === "headers") {
      data = merge(data, request.headers);
    }
  }

  return data;
}

/**
 * Validate the request route
 */
export async function validateAll(
  validation: Route["handler"]["validation"],
  request: Request,
  response: Response,
) {
  if (!validation) return;

  log.info("validation", "started", "Start validating the request");

  if (validation.schema) {
    log.info("validation", "schema", "Validating request schema");
    try {
      const data = resolveDataToParse(validation.validating, validation.schema, request);
      const result = await v.validate(validation.schema, data);

      if (result.data && result.isValid) {
        request.setValidatedData(result.data);
      }

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
    const result = await validation.validate({ request, response });

    // if there is a result, it means it failed
    if (result) {
      log.info("validation", "failed", "Validation failed");

      // a returned Response already carries its own status; anything else is
      // sent with the configured failure status (400 by default)
      if (result instanceof Response) return result;

      return response.send(result, config.get("validation.responseStatus", 400));
    }

    log.info("validation", "passed", "Validation passed");
  }
}

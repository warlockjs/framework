import { fireLifecycleEvent, globalEventsCallbacksMap } from "./use-case-events.mjs";
import { BadSchemaUseCaseError } from "./use-case.errors.mjs";
import { v } from "@warlock.js/seal";
//#region ../../@warlock.js/core/src/use-cases/use-case-pipeline.ts
/**
* Runs the pre-handler pipeline in order:
* onExecuting event → guards → validation → before middleware.
*
* Returns the validated, transformed data ready for the handler. The handler is
* invoked by the caller so retry/benchmark can wrap it in isolation — keeping
* guards, validation, and onExecuting from re-running on each retry attempt.
*
* Throws on guard failure or validation failure.
*
* @example
* const data = await runPipeline({ name, id, data, ctx, startedAt, schema, guards, before });
*/
async function runPipeline(opts) {
	const { name, id, ctx, startedAt, schema, guards, before, onExecuting, ucOnExecuting } = opts;
	let data = opts.data;
	await fireLifecycleEvent({
		name,
		id,
		data,
		schema,
		ctx,
		startedAt
	}, {
		invocation: onExecuting ? [onExecuting] : void 0,
		useCase: ucOnExecuting ? [ucOnExecuting] : void 0,
		global: globalEventsCallbacksMap.onExecuting.length ? globalEventsCallbacksMap.onExecuting : void 0
	});
	if (guards) for (const guard of guards) await guard(Object.freeze(data), ctx);
	if (schema) {
		const result = await v.validate(schema, data);
		if (!result.isValid) throw new BadSchemaUseCaseError(result);
		data = result.data;
	}
	let transformed = data;
	if (before) for (const middleware of before) transformed = await middleware(transformed, ctx);
	return transformed;
}
//#endregion
export { runPipeline };

//# sourceMappingURL=use-case-pipeline.mjs.map
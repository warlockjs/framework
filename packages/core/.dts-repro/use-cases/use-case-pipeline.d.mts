import { UseCaseBeforeMiddleware, UseCaseContext, UseCaseGuard, UseCaseOnExecutingContext } from "./types.mjs";
import { ObjectValidator } from "@warlock.js/seal";

//#region ../../@warlock.js/core/src/use-cases/use-case-pipeline.d.ts
type PipelineOptions<Input> = {
  name: string;
  id: string;
  data: Input;
  ctx: UseCaseContext;
  startedAt: Date;
  schema?: ObjectValidator;
  guards?: UseCaseGuard<Input>[];
  before?: UseCaseBeforeMiddleware<Input>[]; /** Invocation-level onExecuting override */
  onExecuting?: (ctx: UseCaseOnExecutingContext) => void; /** Use-case-level onExecuting */
  ucOnExecuting?: (ctx: UseCaseOnExecutingContext) => void;
};
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
declare function runPipeline<Input>(opts: PipelineOptions<Input>): Promise<Input>;
//#endregion
export { PipelineOptions, runPipeline };
//# sourceMappingURL=use-case-pipeline.d.mts.map
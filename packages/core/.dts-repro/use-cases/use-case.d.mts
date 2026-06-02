import { UseCase, UseCaseContext, UseCaseHandler, UseCaseWithSchema } from "./types.mjs";
import { Infer, ObjectValidator } from "@warlock.js/seal";

//#region ../../@warlock.js/core/src/use-cases/use-case.d.ts
/**
 * Defines and registers a use case.
 *
 * A use case is a named, observable, optionally benchmarked unit of business logic.
 * The returned handler is a typed async function you call with the input data.
 *
 * Execution order: onExecuting → guards → validation → before → handler → after →
 * onCompleted → broadcast. Retry and benchmark wrap the **handler** only.
 *
 * When a `schema` is provided, the handler's input is inferred from it — no manual
 * `Input` generic needed.
 *
 * @example
 * export const createOrderUseCase = useCase({
 *   name: "create_order",
 *   schema: createOrderSchema,           // handler `data` is inferred from this
 *   guards: [authGuard],
 *   handler: async (data, ctx) => orderService.create(data),
 *   after: [sendConfirmationEmail],
 *   retry: { attempts: 3, delay: 500, backoff: "exponential" },
 *   broadcast: true,
 * });
 *
 * // In a controller:
 * const output = await createOrderUseCase({ ...validated, user_id: req.user.id });
 */
declare function useCase<Output, Schema extends ObjectValidator, Ctx extends UseCaseContext = UseCaseContext>(options: UseCaseWithSchema<Output, Schema, Ctx>): UseCaseHandler<Output, Infer<Schema>>;
declare function useCase<Output = any, Input = any, Ctx extends UseCaseContext = UseCaseContext>(options: UseCase<Output, Input, Ctx>): UseCaseHandler<Output, Input>;
//#endregion
export { useCase };
//# sourceMappingURL=use-case.d.mts.map
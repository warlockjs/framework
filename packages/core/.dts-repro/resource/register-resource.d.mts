import { Resource } from "./resource.mjs";

//#region ../../@warlock.js/core/src/resource/register-resource.d.ts
/**
 * Decorator for hand-written Resource classes.
 * Triggers one-time schema normalization (converts string cast types into
 * pre-built ResourceFieldBuilder instances) so transformOutput runs against
 * builders without per-call overhead.
 *
 * @example
 * ```typescript
 * @RegisterResource()
 * class PostResource extends Resource {
 *   static schema = {
 *     id: "number",
 *     title: "string",
 *     keywords: "string[]",
 *   };
 * }
 * ```
 */
declare function RegisterResource(): (target: typeof Resource) => void;
//#endregion
export { RegisterResource };
//# sourceMappingURL=register-resource.d.mts.map
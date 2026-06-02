import { log } from "@warlock.js/logger";
//#region ../../@warlock.js/core/src/use-cases/use-case-broadcast.ts
/**
* Broadcast a successful use-case result through the globally-configured channels.
*
* Fires only when the use case opted in (`broadcast`) and the global transport is
* enabled with at least one channel. Fan-out is isolated via `Promise.allSettled` —
* a failing channel is logged and never affects the use case or sibling channels.
*
* @example
* await broadcastUseCaseResult({ name, id, output, result, broadcast, config });
*/
async function broadcastUseCaseResult(params) {
	const { name, id, output, result, broadcast, config } = params;
	if (!broadcast) return;
	if (config?.enabled === false) return;
	const channels = config?.channels;
	if (!channels || channels.length === 0) return;
	const projector = typeof broadcast === "object" ? broadcast.output : void 0;
	const event = typeof broadcast === "object" && broadcast.event ? broadcast.event : name;
	const payload = projector ? projector(output, result) : output;
	const broadcastEvent = {
		useCase: name,
		event,
		id,
		at: /* @__PURE__ */ new Date(),
		payload
	};
	const outcomes = await Promise.allSettled(channels.map((channel) => channel.broadcast(broadcastEvent)));
	for (const outcome of outcomes) if (outcome.status === "rejected") log.error("use-cases", name, "broadcast channel failed", { error: outcome.reason });
}
//#endregion
export { broadcastUseCaseResult };

//# sourceMappingURL=use-case-broadcast.mjs.map
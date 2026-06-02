import { globalModelEvents } from "../../events/model-events.mjs";
//#region ../../@warlock.js/cascade/src/model/methods/instance-event-methods.ts
async function emitModelEvent(model, event, context) {
	const ctor = model.constructor;
	await model.events.emit(event, model, context);
	await ctor.events().emit(event, model, context);
	await globalModelEvents.emit(event, model, context);
}
function onModelEvent(model, event, listener) {
	return model.events.on(event, listener);
}
function onceModelEvent(model, event, listener) {
	return model.events.once(event, listener);
}
function offModelEvent(model, event, listener) {
	model.events.off(event, listener);
}
//#endregion
export { emitModelEvent, offModelEvent, onModelEvent, onceModelEvent };

//# sourceMappingURL=instance-event-methods.mjs.map
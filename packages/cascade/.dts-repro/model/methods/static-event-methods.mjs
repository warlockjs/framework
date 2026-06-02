import { ModelEvents, globalModelEvents } from "../../events/model-events.mjs";
import { removeModelFromRegistery } from "../register-model.mjs";
//#region ../../@warlock.js/cascade/src/model/methods/static-event-methods.ts
/**
* Isolated event emitter registry — one ModelEvents instance per model constructor.
* Encapsulated here so no other module needs to know it exists.
*/
const modelEventsRegistry = /* @__PURE__ */ new WeakMap();
function getModelEvents(ModelClass) {
	let events = modelEventsRegistry.get(ModelClass);
	if (!events) {
		events = new ModelEvents();
		modelEventsRegistry.set(ModelClass, events);
	}
	return events;
}
function cleanupModelEvents(ModelClass) {
	modelEventsRegistry.delete(ModelClass);
	removeModelFromRegistery(ModelClass.name);
}
function onStaticEvent(ModelClass, event, listener) {
	return ModelClass.events().on(event, listener);
}
function onceStaticEvent(ModelClass, event, listener) {
	return ModelClass.events().once(event, listener);
}
function offStaticEvent(ModelClass, event, listener) {
	ModelClass.events().off(event, listener);
}
function getGlobalEvents() {
	return globalModelEvents;
}
//#endregion
export { cleanupModelEvents, getGlobalEvents, getModelEvents, offStaticEvent, onStaticEvent, onceStaticEvent };

//# sourceMappingURL=static-event-methods.mjs.map
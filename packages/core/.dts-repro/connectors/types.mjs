//#region ../../@warlock.js/core/src/connectors/types.ts
/**
* When a connector boots relative to user code (main, routes, events).
*
* - `Early`: before user code is imported. For services user code
*   needs at import time (database, cache, logger, storage, mailer).
* - `Late`: after user code is imported. For services that bind to
*   things user code registered (http scans the router; socket
*   depends on http's instance).
*/
let ConnectorLifecyclePhase = /* @__PURE__ */ function(ConnectorLifecyclePhase) {
	ConnectorLifecyclePhase["Early"] = "early";
	ConnectorLifecyclePhase["Late"] = "late";
	return ConnectorLifecyclePhase;
}({});
/**
* Connector priority constants
*/
let ConnectorPriority = /* @__PURE__ */ function(ConnectorPriority) {
	ConnectorPriority[ConnectorPriority["LOGGER"] = 0] = "LOGGER";
	ConnectorPriority[ConnectorPriority["MAILER"] = 1] = "MAILER";
	ConnectorPriority[ConnectorPriority["DATABASE"] = 2] = "DATABASE";
	ConnectorPriority[ConnectorPriority["COMMUNICATOR"] = 3] = "COMMUNICATOR";
	ConnectorPriority[ConnectorPriority["CACHE"] = 4] = "CACHE";
	ConnectorPriority[ConnectorPriority["HTTP"] = 5] = "HTTP";
	ConnectorPriority[ConnectorPriority["STORAGE"] = 6] = "STORAGE";
	ConnectorPriority[ConnectorPriority["SOCKET"] = 7] = "SOCKET";
	return ConnectorPriority;
}({});
//#endregion
export { ConnectorLifecyclePhase, ConnectorPriority };

//# sourceMappingURL=types.mjs.map
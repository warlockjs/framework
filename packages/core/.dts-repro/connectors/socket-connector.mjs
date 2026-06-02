import { container } from "../container/index.mjs";
import "./types.mjs";
import { BaseConnector } from "./base-connector.mjs";
import baseConfig from "@mongez/config";
import { log } from "@warlock.js/logger";
import { createServer } from "http";
import { createServer as createServer$1 } from "https";
//#region ../../@warlock.js/core/src/connectors/socket-connector.ts
/**
* Shown when a project enables sockets (a `socket` config is present) but the
* optional `socket.io` peer is not installed.
*/
const SOCKET_INSTALL_INSTRUCTIONS = `
Realtime socket server requires the socket.io package.
Install it with:

  warlock add socket

Or manually:

  npm install socket.io
  pnpm add socket.io
  yarn add socket.io
`.trim();
/**
* Socket Connector
* Manages Socket server (Socket.IO) lifecycle
*/
var SocketConnector = class extends BaseConnector {
	constructor(..._args) {
		super(..._args);
		this.name = "socket";
		this.priority = 7;
		this.lifecyclePhase = "late";
		this.watchedFiles = ["src/config/socket.ts"];
	}
	/**
	* Boot the connector
	*/
	async boot() {
		const socketConfig = baseConfig.get("socket");
		if (!socketConfig) return;
		let SocketServer;
		try {
			({Server: SocketServer} = await import("socket.io"));
		} catch {
			throw new Error(SOCKET_INSTALL_INSTRUCTIONS);
		}
		log.info("socket", "connection", "Starting Socket.IO server");
		let server;
		if (container.has("http.server")) server = container.get("http.server").server;
		else {
			server = socketConfig.ssl ? createServer$1() : createServer();
			server.listen(socketConfig.port);
		}
		container.set("socket.rawServer", server);
		this.socket = new SocketServer(server, socketConfig.options);
		container.set("socket", this.socket);
	}
	/**
	* Initialize Socket server
	*/
	async start() {
		if (!baseConfig.get("socket") || !this.socket) return;
		log.success("socket", "connection", "Established Socket.IO server");
		this.active = true;
	}
	/**
	* Shutdown HTTP server
	*/
	async shutdown() {
		if (!this.active) return;
		if (container.has("socket")) container.get("socket").close();
		if (container.has("socket.rawServer")) container.get("socket.rawServer").close();
		this.active = false;
	}
};
//#endregion
export { SocketConnector };

//# sourceMappingURL=socket-connector.mjs.map
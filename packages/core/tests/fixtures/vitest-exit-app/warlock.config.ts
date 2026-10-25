import { webConnector } from "../../../../web/src/server/web-connector-factory";

// `EXIT_APP_WEB=1` adds the web connector, so the global-setup test server boots
// a real Vite dev server (middleware mode, HMR websocket, file watchers) and the
// exit assertion covers closing it.
export default {
  build: { outdir: "dist" },
  connectors: process.env.EXIT_APP_WEB === "1" ? [webConnector()] : [],
};

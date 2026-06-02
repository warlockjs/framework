import { Router } from "../router/router.mjs";
import { DataSource } from "@warlock.js/cascade";
import { FastifyInstance } from "fastify";
import { Server } from "socket.io";

//#region ../../@warlock.js/core/src/application/app.d.ts
type RuntimeApplication = {
  socket: Server;
  http: FastifyInstance;
  router: Router;
  database: DataSource;
};
declare const app: RuntimeApplication;
//#endregion
export { app };
//# sourceMappingURL=app.d.mts.map
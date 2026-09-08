import { type DataSource } from "@warlock.js/cascade";
import { type FastifyInstance } from "fastify";
import { type Server } from "socket.io";
import { type Router } from "../router";
import { container } from "./../container";

type RuntimeApplication = {
  socket: Server;
  http: FastifyInstance;
  router: Router;
  database: DataSource;
};

export const app: RuntimeApplication = {
  /**
   * Socket Io Instance
   * Available only if socket.io config file exists
   */
  get socket() {
    return container.get("socket");
  },
  /**
   * HTTP Server Instance
   * Available only if http config file exists
   */
  get http() {
    return container.get("http.server");
  },
  /**
   * Router Instance
   *
   * Unlike `socket`/`database`, the router is set unconditionally at
   * `router.ts` module load (there is no "no router configured" case), so a
   * miss here is never a legitimate absence — it means either a genuine bug
   * or a duplicate-instance dev-path read. `getOrFail` surfaces that instead
   * of silently returning `undefined`.
   */
  get router() {
    return container.getOrFail("router");
  },
  /**
   * Database Instance
   * Available only if database config file exists
   */
  get database() {
    return container.get("database.source");
  },
};

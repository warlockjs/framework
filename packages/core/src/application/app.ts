import { type DataSource } from "@warlock.js/cascade";
import { type FastifyInstance } from "fastify";
import { type Server } from "socket.io";
import { type Router } from "../router";
import { container } from "./../container";

type RuntimeApplication = {
  socket: Server | undefined;
  http: FastifyInstance | undefined;
  router: Router;
  database: DataSource | undefined;
};

export const app: RuntimeApplication = {
  /**
   * Socket Io Instance
   * Available only if socket.io config file exists
   */
  get socket() {
    return container.tryGet("socket");
  },
  /**
   * HTTP Server Instance
   * Available only if http config file exists
   */
  get http() {
    return container.tryGet("http.server");
  },
  /**
   * Router Instance
   *
   * Unlike `socket`/`database`, the router is set unconditionally at
   * `router.ts` module load (there is no "no router configured" case), so a
   * miss here is never a legitimate absence — it means either a genuine bug
   * or a duplicate-instance dev-path read. `get` surfaces that instead of
   * silently returning `undefined`.
   */
  get router() {
    return container.get("router");
  },
  /**
   * Database Instance
   * Available only if database config file exists
   */
  get database() {
    return container.tryGet("database.source");
  },
};

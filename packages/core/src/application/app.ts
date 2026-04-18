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
   */
  get router() {
    return container.get("router");
  },
  /**
   * Database Instance
   * Available only if database config file exists
   */
  get database() {
    return container.get("database.source");
  },
};

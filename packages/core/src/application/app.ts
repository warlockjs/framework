import { type DataSource } from "@warlock.js/cascade";
import { type FastifyInstance } from "fastify";
import { type Server } from "socket.io";
import { type Router } from "../router";
import { container } from "./../container";

export const app = {
  /**
   * Socket Io Instance
   * Available only if socket.io config file exists
   */
  get socket(): Server {
    return container.get("socket");
  },
  /**
   * HTTP Server Instance
   * Available only if http config file exists
   */
  get http(): FastifyInstance {
    return container.get("http.server");
  },
  /**
   * Router Instance
   */
  get router(): Router {
    return container.get("router");
  },
  /**
   * Database Instance
   * Available only if database config file exists
   */
  get database(): DataSource {
    return container.get("database.source");
  },
};

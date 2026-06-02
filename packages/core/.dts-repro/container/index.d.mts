import { Router } from "../router/router.mjs";
import { DataSource } from "@warlock.js/cascade";
import { FastifyInstance } from "fastify";
import { Server } from "socket.io";

//#region ../../@warlock.js/core/src/container/index.d.ts
/**
 * Known container types for better IDE support
 */
type ContainerTypes = {
  router: Router;
  "http.server": FastifyInstance;
  "http.baseUrl": string;
  socket: Server;
  "database.source": DataSource;
};
type ContainerKeys = keyof ContainerTypes | (string & {});
declare class Container {
  /**
   * Set a value in the container
   */
  set<K extends keyof ContainerTypes>(key: K, value: ContainerTypes[K]): void;
  set<T = any>(key: string, value: T): void;
  /**
   * Get a value from the container
   */
  get<K extends keyof ContainerTypes>(key: K): ContainerTypes[K];
  get<T = any>(key: string): T;
  /**
   * Check if a key exists in the container
   */
  has(key: ContainerKeys): boolean;
  /**
   * Delete a key from the container
   */
  delete(key: string): void;
}
declare const container: Container;
//#endregion
export { ContainerTypes, container };
//# sourceMappingURL=index.d.mts.map
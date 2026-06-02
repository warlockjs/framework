import { ServerOptions } from "node:http";

//#region ../../@warlock.js/core/src/socket/types.d.ts
/**
 * Socket options
 */
type SocketOptions = {
  /**
   * Http Port, use it if the http is not enabled in the project
   */
  port?: number;
  /**
   * Socket.IO options
   */
  options?: ServerOptions;
};
//#endregion
export { SocketOptions };
//# sourceMappingURL=types.d.mts.map
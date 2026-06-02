import Fastify, { FastifyServerOptions } from "fastify";

//#region ../../@warlock.js/core/src/http/server.d.ts
type FastifyInstance$1 = ReturnType<typeof Fastify>;
declare function startHttpServer(options?: FastifyServerOptions): FastifyInstance$1;
/**
 * Expose the server to be publicly accessible
 */
declare function getHttpServer(): FastifyInstance$1;
//#endregion
export { FastifyInstance$1 as FastifyInstance, getHttpServer, startHttpServer };
//# sourceMappingURL=server.d.mts.map
/**
 * Page actions over a real socket with `http.multipart.routes: "declared"`:
 * a page whose route carries `uploads` takes a file (200), and a page action
 * without it answers 415. The POST routes are registered with the options
 * `installPageRoutes` builds from `config.uploads`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

import { registerHttpPlugins, router, setConfig, type Request } from "@warlock.js/core";
import Fastify from "fastify";
import { createElement } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import DefaultApp from "../components/default-app";
import { WARLOCK_DATA_REQUEST_HEADER, WARLOCK_DATA_REQUEST_VALUE } from "../routing/data-request";
import { createPageRouteHandler } from "./create-page-route-handler";
import { connectPageContext } from "./execute-page-request";
import type { PipelineStore } from "./execute-page-request.types";

vi.mock("../shared", () => ({
  enterSharedScope: vi.fn(),
  sealShared: vi.fn(async () => Object.freeze({})),
}));

const BOUNDARY = "----declaredboundary";
const modules = new Map<string, unknown>();

function mountPage(
  server: ReturnType<typeof Fastify>,
  path: string,
  page: Record<string, unknown>,
  uploads: boolean | undefined,
): void {
  modules.set("app.tsx", { config: {}, default: DefaultApp });
  modules.set(`page:${path}`, page);

  router.post(
    path,
    createPageRouteHandler({
      path,
      name: path,
      appFile: "app.tsx",
      pageFile: `page:${path}`,
      loadModule: async (moduleId: string) => modules.get(moduleId),
      httpServer: server,
      mode: "action",
    }),
    { isPage: true, ...(uploads === undefined ? {} : { uploads }) },
  );
}

/** Posts one multipart file to the listening server over a real connection. */
function postFile(port: number, path: string): Promise<{ status: number; body: string }> {
  const payload = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="doc"; filename="a.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\nhello\r\n--${BOUNDARY}--\r\n`,
  );

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          host: "localhost",
          origin: "http://localhost",
          "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
          "content-length": payload.length,
          [WARLOCK_DATA_REQUEST_HEADER]: WARLOCK_DATA_REQUEST_VALUE,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
      },
    );

    req.on("error", reject);
    req.end(payload);
  });
}

describe('page actions under http.multipart.routes: "declared"', () => {
  const server = Fastify();
  let port = 0;

  beforeAll(async () => {
    const store = new AsyncLocalStorage<PipelineStore>();

    connectPageContext({
      buildStore: (payload) => payload as never,
      getStore: () => store.getStore(),
      run: (value, callback) => store.run(value, callback),
    });
    setConfig("http.multipart", { routes: "declared" } as never);
    await registerHttpPlugins(server);

    const action = ({ request }: { request: Request }) => ({
      filename: request.file("doc")?.name ?? null,
    });
    const page = { default: () => createElement("main", null, "page"), action };

    mountPage(server, "/__declared-upload", page, true);
    mountPage(server, "/__declared-plain", page, undefined);

    router.scan(server);
    await server.listen({ port: 0, host: "127.0.0.1" });
    port = (server.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    setConfig("http.multipart", undefined as never);
    await server.close();
  });

  it("parses the file on an action whose route declares uploads", async () => {
    const response = await postFile(port, "/__declared-upload");

    expect(response.status).toBe(200);
    expect(response.body).toContain("a.txt");
  });

  it("answers 415 on an action without uploads", async () => {
    const response = await postFile(port, "/__declared-plain");

    expect(response.status).toBe(415);
    expect(response.body).toContain("EC109");
  });
});

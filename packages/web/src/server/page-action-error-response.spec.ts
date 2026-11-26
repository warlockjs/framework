/**
 * Web data replies under an app's `http.errorResponse` formatter, over a REAL
 * core HTTP server (`startHttpServer`, which registers the formatter) and the
 * REAL page pipeline. The formatter must never rewrite a reply to a request
 * carrying `x-warlock-data`: the client parses those bodies itself (a failed
 * page action's 422 `{ actionData }`, the data 404 for an unknown `_action`).
 * API JSON errors on the same server are still formatted.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import {
  registerHttpPlugins,
  router,
  setConfig,
  startHttpServer,
  type FastifyInstance,
  type HttpErrorResponseFormatter,
  type Request,
} from "@warlock.js/core";
import { parse } from "devalue";
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

const SAME_ORIGIN = "http://localhost";
const FORM_HEADERS = {
  "content-type": "application/x-www-form-urlencoded",
  origin: SAME_ORIGIN,
};
const DATA_HEADERS = {
  ...FORM_HEADERS,
  [WARLOCK_DATA_REQUEST_HEADER]: WARLOCK_DATA_REQUEST_VALUE,
};

type ActionContext = { request: Request; response: any };

const formatter = vi.fn<HttpErrorResponseFormatter>(({ status, requestId }) => ({
  error: {
    code: status === 422 ? "validationFailed" : `http${status}`,
    message: "Request failed.",
  },
  requestId,
}));

const modules = new Map<string, unknown>();

function mountPage(server: FastifyInstance, path: string, page: Record<string, unknown>): void {
  const pageFile = `page:${path}`;

  modules.set("app.tsx", { config: {}, default: DefaultApp });
  modules.set(pageFile, page);

  const handlerOptions = {
    path,
    name: path,
    appFile: "app.tsx",
    pageFile,
    loadModule: async (moduleId: string) => modules.get(moduleId),
    httpServer: server,
  };

  router.get(path, createPageRouteHandler(handlerOptions));
  router.post(path, createPageRouteHandler({ ...handlerOptions, mode: "action" }), {
    isPage: true,
  });
}

describe("page actions under an http.errorResponse formatter", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const store = new AsyncLocalStorage<PipelineStore>();

    connectPageContext({
      buildStore: (payload) => payload as never,
      getStore: () => store.getStore(),
      run: (value, callback) => store.run(value, callback),
    });

    setConfig("http.errorResponse", formatter);
    server = startHttpServer();
    await registerHttpPlugins(server);

    mountPage(server, "/__formatted-action", {
      default: () => createElement("main", null, "page"),
      loader: () => ({ ok: true }),
      actions: {
        join: ({ response }: ActionContext) =>
          response.unprocessableEntity({ message: "workspaceNotFound" }),
      },
    });

    router.post("/__formatted-api", ({ response }: ActionContext) =>
      response.unprocessableEntity({ message: "workspaceNotFound" }),
    );

    router.scan(server);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    setConfig("http.errorResponse", undefined as never);
  });

  it("delivers a failing page action's 422 { actionData } untouched to a JS submit", async () => {
    formatter.mockClear();

    const response = await server.inject({
      method: "POST",
      url: "/__formatted-action",
      headers: DATA_HEADERS,
      payload: "_action=join",
    });
    const body = parse(response.body) as Record<string, any>;

    expect(response.statusCode).toBe(422);
    expect(Object.keys(body)).toEqual(["actionData"]);
    expect(body.actionData.ok).toBe(false);
    expect(body.actionData.formErrors).toEqual(["workspaceNotFound"]);
    expect(formatter).not.toHaveBeenCalled();
  });

  it("delivers the data 404 for an unknown _action untouched", async () => {
    formatter.mockClear();

    const response = await server.inject({
      method: "POST",
      url: "/__formatted-action",
      headers: DATA_HEADERS,
      payload: "_action=nope",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
    expect(formatter).not.toHaveBeenCalled();
  });

  it("still formats an API JSON error on the same server", async () => {
    formatter.mockClear();

    const response = await server.inject({
      method: "POST",
      url: "/__formatted-api",
      headers: { "content-type": "application/json" },
      payload: "{}",
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: { code: "validationFailed", message: "Request failed." },
      requestId: expect.any(String),
    });
    expect(formatter).toHaveBeenCalledTimes(1);
  });
});

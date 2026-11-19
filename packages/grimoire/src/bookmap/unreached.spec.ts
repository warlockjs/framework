import { describe, expect, it } from "vitest";
import type { BookFile, BookRoute } from "../contracts/adapter";
import { matchApps } from "../apps";
import { resolveOwnership } from "../ownership";
import {
  codeFile,
  facts as buildFacts,
  feature,
  step,
  written as buildWritten,
} from "../../tests/support/written-model";
import { buildCollectedFiles } from "./index";

const MODULE = "src/app/orders";

function file(path: string, type: string, imports: string[] = [], extra: Partial<BookFile> = {}) {
  return codeFile(path, imports, { type, module: MODULE, ...extra });
}

function orders(extraFiles: BookFile[] = [], middleware: string[] = ["authOnly"]) {
  const route: BookRoute = {
    method: "GET",
    path: "/api/orders",
    name: null,
    sourceFile: `${MODULE}/routes.ts`,
    handler: "listOrders",
    controller: null,
    action: null,
    handlerFile: `${MODULE}/controllers/list-orders.controller.ts`,
    middleware,
    auth: { required: true, userTypes: [] },
    isPage: false,
    description: null,
  };
  const facts = buildFacts(
    [
      file(`${MODULE}/routes.ts`, "routes", [
        `${MODULE}/controllers/list-orders.controller.ts`,
        `${MODULE}/controllers/other.controller.ts`,
        `${MODULE}/middleware/auth-only.middleware.ts`,
      ]),
      file(`${MODULE}/controllers/list-orders.controller.ts`, "controller"),
      file(`${MODULE}/controllers/other.controller.ts`, "controller"),
      file(`${MODULE}/middleware/auth-only.middleware.ts`, "source"),
      file(`${MODULE}/migrations/2026-create-orders.migration.ts`, "migration"),
      file(`${MODULE}/seeds/orders.seed.ts`, "seed"),
      file(`${MODULE}/commands/prune-orders.command.ts`, "command"),
      file(`${MODULE}/components/order-layout.tsx`, "layout"),
      file(`${MODULE}/components/root.tsx`, "root"),
      file(`${MODULE}/components/order-badge.tsx`, "component"),
      file(`${MODULE}/tests/helpers.ts`, "source"),
      file(`${MODULE}/tests/orders.spec.ts`, "spec", [`${MODULE}/tests/helpers.ts`]),
      ...extraFiles,
    ],
    { routes: [route] },
  );
  const written = buildWritten({
    features: [
      feature({
        id: "orders",
        folders: [MODULE],
        flows: [{ id: "list-orders", steps: [step(1, "route", "GET /api/orders")] }],
      }),
    ],
  });

  return {
    written,
    facts,
    ownership: resolveOwnership(written, facts),
    apps: matchApps(written.apps, facts),
    proofs: [],
    results: null,
    testHashes: {},
  };
}

describe("GR3006 unreached files: roles, middleware and spec helpers", () => {
  it("reaches the middleware the matched route names, not the routes file's other imports", () => {
    const collected = buildCollectedFiles(orders());
    const routeStep = collected.flows["orders/list-orders"]?.steps[0];

    expect(routeStep?.files).toContain(`${MODULE}/middleware/auth-only.middleware.ts`);
    expect(routeStep?.files).not.toContain(`${MODULE}/controllers/other.controller.ts`);
    expect(collected.features["orders"]?.unreached).not.toContain(
      `${MODULE}/middleware/auth-only.middleware.ts`,
    );
  });

  it("finds middleware by the name a file exports", () => {
    const input = orders(
      [
        file(`${MODULE}/guards/guard.ts`, "source", [], {
          exports: [{ name: "ownerOnly", about: null }],
        }),
      ],
      ["ownerOnly"],
    );
    const routeStep = buildCollectedFiles(input).flows["orders/list-orders"]?.steps[0];

    expect(routeStep?.files).toContain(`${MODULE}/guards/guard.ts`);
  });

  it("matches a middleware name by stem only for *.middleware.* files", () => {
    const input = orders([file(`${MODULE}/config/auth.ts`, "source")], ["auth"]);
    const routeStep = buildCollectedFiles(input).flows["orders/list-orders"]?.steps[0];

    expect(routeStep?.files).not.toContain(`${MODULE}/config/auth.ts`);
  });

  it("exempts migration, seed, command, layout and root files; spec-only helpers count as reached", () => {
    const unreached = buildCollectedFiles(orders()).features["orders"]?.unreached;

    // Only the controller no flow names and the component of no role are left.
    expect(unreached).toEqual([
      `${MODULE}/components/order-badge.tsx`,
      `${MODULE}/controllers/other.controller.ts`,
    ]);
  });

  it("still lists a helper that a non-spec file also imports", () => {
    const input = orders([
      file(`${MODULE}/components/uses-helper.tsx`, "component", [`${MODULE}/tests/helpers.ts`]),
    ]);
    const unreached = buildCollectedFiles(input).features["orders"]?.unreached ?? [];

    expect(unreached).toContain(`${MODULE}/tests/helpers.ts`);
  });

  it("still lists a source file that only its own spec imports", () => {
    const input = orders([
      file(`${MODULE}/services/refund.ts`, "source"),
      file(`${MODULE}/services/refund.spec.ts`, "spec", [`${MODULE}/services/refund.ts`]),
    ]);
    const unreached = buildCollectedFiles(input).features["orders"]?.unreached ?? [];

    expect(unreached).toContain(`${MODULE}/services/refund.ts`);
    expect(unreached).not.toContain(`${MODULE}/tests/helpers.ts`);
  });

  it("leaves a mail step unchecked (found null) when there are no route facts", () => {
    const input = orders();

    input.facts.routes = null;
    input.written.features[0]?.flows[0]?.steps.push(step(2, "mail", "welcome"));

    const steps = buildCollectedFiles(input).flows["orders/list-orders"]?.steps ?? [];

    expect(steps.map((item) => item.found)).toEqual([null, null]);
  });
});

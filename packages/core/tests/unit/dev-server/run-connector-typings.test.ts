import { describe, expect, it, vi } from "vitest";
import {
  ConnectorLifecyclePhase,
  type Connector,
  type ConnectorBuildContext,
  type ConnectorBuildContribution,
} from "../../../src/connectors/types";
import { runConnectorTypings } from "../../../src/dev-server/run-connector-typings";
import type { ResolvedBuildConfig } from "../../../src/production/resolve-build-config";

/*
  `warlock generate.typings` used to write config and translation typings only;
  `web-routes.d.ts` came from the dev server or `warlock build`, so a clean
  checkout failed `tsc` on every typed `href()` before the build ever ran.
  Core cannot import web, so web contributes through the connector's `build`
  contribution — the seam `warlock build` already drains.
*/

const options = () => ({}) as ResolvedBuildConfig;
const routes = [{ name: "users.list", path: "/users", method: "GET" as const }];

function connector(name: string, build?: ConnectorBuildContribution): Connector {
  return {
    name,
    priority: 0,
    lifecyclePhase: ConnectorLifecyclePhase.Early,
    build,
    isActive: () => false,
    boot: () => undefined,
    start: async () => undefined,
    stop: async () => undefined,
    shutdown: async () => undefined,
  } as unknown as Connector;
}

function run(connectors: Connector[]) {
  const collectRoutes = vi.fn(async () => routes);

  return {
    collectRoutes,
    done: runConnectorTypings({ connectors, appRoot: "/app", options, collectRoutes }),
  };
}

describe("runConnectorTypings", () => {
  it("hands the web connector's typings hook the build context with the named API snapshot", async () => {
    const seen: ConnectorBuildContext[] = [];
    const { done } = run([connector("web", { typings: (context) => void seen.push(context) })]);

    await done;

    expect(seen).toHaveLength(1);
    expect(seen[0]?.appRoot).toBe("/app");
    expect(seen[0]?.namedApiRoutes).toEqual(routes);
  });

  it("is a silent no-op for an API-only app: no hook, no snapshot child", async () => {
    const { done, collectRoutes } = run([connector("http"), connector("database", {})]);

    await expect(done).resolves.toBeUndefined();
    expect(collectRoutes).not.toHaveBeenCalled();
  });

  it("names the connector when its typings hook fails", async () => {
    const { done } = run([
      connector("web", {
        typings: () => {
          throw new Error("boom");
        },
      }),
    ]);

    await expect(done).rejects.toThrow(/"web" failed during typings: boom/);
  });
});

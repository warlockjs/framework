import { afterEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  collectRouteRegistrationSnapshot: vi.fn(async () => ({ routes: [] })),
  collectRoutes: undefined as (() => Promise<unknown>) | undefined,
}));
const { collectRouteRegistrationSnapshot } = hoisted;

vi.mock("../../dev-server/files-orchestrator", () => ({
  filesOrchestrator: { initializeAll: vi.fn(async () => undefined) },
}));
vi.mock("../../dev-server/type-generator", () => ({
  typeGenerator: { generateAll: vi.fn(async () => undefined) },
}));
vi.mock("../../dev-server/run-connector-typings", () => ({
  runConnectorTypings: vi.fn(async (options: { collectRoutes: () => Promise<unknown> }) => {
    hoisted.collectRoutes = options.collectRoutes;
  }),
}));
vi.mock("../../warlock-config/warlock-config.manager", () => ({
  warlockConfigManager: { isLoaded: false, get: () => undefined },
}));
vi.mock("../../production/route-registration-snapshot", () => ({
  collectRouteRegistrationSnapshot: hoisted.collectRouteRegistrationSnapshot,
}));

import { typingsGeneratorCommand } from "./typings-generator.command";

describe("warlock generate.typings — route registration timeout", () => {
  afterEach(() => {
    delete process.env.WARLOCK_ROUTE_REGISTRATION_TIMEOUT_MS;
    collectRouteRegistrationSnapshot.mockClear();
    hoisted.collectRoutes = undefined;
  });

  it("uses the same resolved timeout as warlock build (FORMAI: 30s default failed loaded builds)", async () => {
    process.env.WARLOCK_ROUTE_REGISTRATION_TIMEOUT_MS = "120000";

    await typingsGeneratorCommand.execute({ args: [], options: {} } as never);
    await hoisted.collectRoutes?.();

    expect(collectRouteRegistrationSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 120_000 }),
    );
  });
});

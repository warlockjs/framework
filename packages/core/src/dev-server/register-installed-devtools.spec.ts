import { afterEach, describe, expect, it, vi } from "vitest";
import { connectorsManager } from "../connectors/connectors-manager";
import type { Connector } from "../connectors/types";
import { devLogWarn } from "./dev-logger";
import { registerInstalledDevtools } from "./register-installed-devtools";

vi.mock("./dev-logger", () => ({ devLogWarn: vi.fn() }));

function devtoolsConnector(): Connector {
  return { name: "devtools" } as Connector;
}

function missingPackageError(specifier: string): Error {
  return Object.assign(new Error(`Cannot find package '${specifier}' imported from /app/core.js`), {
    code: "ERR_MODULE_NOT_FOUND",
  });
}

describe("registerInstalledDevtools", () => {
  const registered: Connector[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(devLogWarn).mockClear();
    registered.length = 0;
  });

  function spyRegistry(alreadyHasDevtools = false) {
    vi.spyOn(connectorsManager, "has").mockImplementation(
      (name) => alreadyHasDevtools && name === "devtools",
    );
    vi.spyOn(connectorsManager, "register").mockImplementation((...connectors) => {
      registered.push(...connectors);
    });
  }

  it("registers the connector when the package is installed", async () => {
    spyRegistry();

    await expect(registerInstalledDevtools(async () => ({ devtoolsConnector }))).resolves.toBe(
      true,
    );

    expect(registered.map((connector) => connector.name)).toEqual(["devtools"]);
  });

  it("stays silent when the package is not installed", async () => {
    spyRegistry();

    const result = await registerInstalledDevtools(async () => {
      throw missingPackageError("@warlock.js/devtools");
    });

    expect(result).toBe(false);
    expect(registered).toEqual([]);
    expect(devLogWarn).not.toHaveBeenCalled();
  });

  it("warns, without throwing, when an installed devtools fails to load", async () => {
    spyRegistry();

    const result = await registerInstalledDevtools(async () => {
      throw missingPackageError("fastify");
    });

    expect(result).toBe(false);
    expect(registered).toEqual([]);
    expect(devLogWarn).toHaveBeenCalledOnce();
  });

  it("leaves a hand-registered devtools connector alone", async () => {
    spyRegistry(true);
    const load = vi.fn(async () => ({ devtoolsConnector }));

    await expect(registerInstalledDevtools(load)).resolves.toBe(false);

    expect(load).not.toHaveBeenCalled();
    expect(registered).toEqual([]);
  });
});

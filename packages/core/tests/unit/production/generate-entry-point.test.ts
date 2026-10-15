import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connector } from "../../../src/connectors/types";

/**
 * D7b — the generated production entry (`.warlock/production/app.ts`) must
 * emit `await Application.runStartupValidators();` between the app-code
 * imports and the late-phase connector start, so a rejecting validator
 * aborts boot before the http connector binds a port. Asserted on the
 * generated TEXT's shape (exact statement + ordering), not a keyword search.
 */

const putFileAsync = vi.hoisted(() =>
  vi.fn(async (_filePath: string, _content: string) => undefined),
);

vi.mock("@warlock.js/fs", () => ({
  ensureDirectoryAsync: vi.fn(async () => undefined),
  fileExistsAsync: vi.fn(async () => false),
  getFileAsync: vi.fn(async () => ""),
  getJsonFileAsync: vi.fn(async () => ({})),
  putFileAsync,
  removeDirectoryAsync: vi.fn(async () => undefined),
}));

const { ProductionBuilder } = await import("../../../src/production/production-builder");

/** `generateEntryPoint` is private; reach it the same way the class itself
 * reaches its own private fields — through an instance cast. */
type BuilderInternals = {
  connectors: readonly Connector[];
  generatedFiles: { locales: boolean; events: boolean; main: boolean; routes: boolean };
  generateEntryPoint(): Promise<void>;
};

/** Only the name is read when the entry is generated. */
function buildConnector(name: string): Connector {
  return { name } as unknown as Connector;
}

const NO_APP_FILES = { locales: false, events: false, main: false, routes: false };

function generatedEntryContent(
  generatedFiles: BuilderInternals["generatedFiles"],
  connectors: Connector[] = [],
): Promise<string> {
  const builder = new ProductionBuilder() as unknown as BuilderInternals;
  builder.generatedFiles = generatedFiles;
  builder.connectors = connectors;

  return builder.generateEntryPoint().then(() => {
    const call = putFileAsync.mock.calls.find(([path]) => path.endsWith("app.ts"));
    return call?.[1] as string;
  });
}

describe("ProductionBuilder.generateEntryPoint — D7 boot-order wiring", () => {
  beforeEach(() => {
    putFileAsync.mockClear();
  });

  it("emits the validators call between the app-code imports and the late-phase connector start", async () => {
    const content = await generatedEntryContent({
      locales: true,
      events: true,
      main: true,
      routes: true,
    });

    const lastAppImportIndex = content.indexOf('await import("./routes");');
    const validatorsIndex = content.indexOf("await Application.runStartupValidators();");
    const latePhaseIndex = content.indexOf(
      "await connectorsManager.startPhase(ConnectorLifecyclePhase.Late);",
    );

    expect(lastAppImportIndex).toBeGreaterThan(-1);
    expect(validatorsIndex).toBeGreaterThan(-1);
    expect(latePhaseIndex).toBeGreaterThan(-1);

    expect(validatorsIndex).toBeGreaterThan(lastAppImportIndex);
    expect(latePhaseIndex).toBeGreaterThan(validatorsIndex);
  });

  it("still emits the validators call before the late phase when no app files were generated", async () => {
    const content = await generatedEntryContent({
      locales: false,
      events: false,
      main: false,
      routes: false,
    });

    const earlyPhaseIndex = content.indexOf(
      "await connectorsManager.startPhase(ConnectorLifecyclePhase.Early);",
    );
    const validatorsIndex = content.indexOf("await Application.runStartupValidators();");
    const latePhaseIndex = content.indexOf(
      "await connectorsManager.startPhase(ConnectorLifecyclePhase.Late);",
    );

    expect(earlyPhaseIndex).toBeGreaterThan(-1);
    expect(validatorsIndex).toBeGreaterThan(earlyPhaseIndex);
    expect(latePhaseIndex).toBeGreaterThan(validatorsIndex);
  });

  it("preflights the http port after the config loader and before the early phase", async () => {
    const content = await generatedEntryContent(NO_APP_FILES);

    const configLoaderIndex = content.indexOf('import "./config-loader";');
    const preflightIndex = content.indexOf("await preflightConfiguredHttpPort();");
    const earlyPhaseIndex = content.indexOf(
      "await connectorsManager.startPhase(ConnectorLifecyclePhase.Early);",
    );

    // The port is the cheapest thing in the boot to check and the one most
    // likely to be wrong; checking it after the early phase — which is where
    // the late-phase http connector's own preflight lands — pays for a
    // database and cache connection before reporting a busy port.
    expect(configLoaderIndex).toBeGreaterThan(-1);
    expect(preflightIndex).toBeGreaterThan(configLoaderIndex);
    expect(earlyPhaseIndex).toBeGreaterThan(preflightIndex);
  });

  it("does not introduce a new import — Application is already imported for early-phase startup", async () => {
    const content = await generatedEntryContent({
      locales: false,
      events: false,
      main: false,
      routes: false,
    });

    const importLines = content
      .split("\n")
      .filter((line) => line.trimStart().startsWith("import "));

    expect(importLines).toEqual([
      'import "./bootstrap";',
      'import "./config-loader";',
      'import { registerConfiguredConnectors } from "@warlock.js/core";',
      'import warlockConfig from "../../warlock.config";',
      // `preflightConfiguredHttpPort` rides the import the entry already has
      // rather than adding a sixth line — it comes from the same package.
      'import { Application, connectorsManager, ConnectorLifecyclePhase, preflightConfiguredHttpPort } from "@warlock.js/core";',
    ]);
  });
});

/**
 * The entry must register the connectors declared in `warlock.config` before
 * any phase starts, so the bundle boots exactly the connectors this build
 * drained contributions from.
 *
 * The array is BAKED IN: the entry imports the app's `warlock.config`
 * statically — so esbuild bundles it — and passes `connectors` as an argument.
 * An artifact has no config file beside it to read, so a registration that
 * relied on a loaded config manager would register nothing and say nothing.
 */
const REGISTRATION_CALL =
  "registerConfiguredConnectors(warlockConfig.connectors ?? [], { expectedNames: [] });";

describe("ProductionBuilder.generateEntryPoint — config-declared connector registration", () => {
  beforeEach(() => {
    putFileAsync.mockClear();
  });

  it("registers config connectors after the config loader and before the early phase", async () => {
    const content = await generatedEntryContent({
      locales: true,
      events: true,
      main: true,
      routes: true,
    });

    const configLoaderIndex = content.indexOf('import "./config-loader";');
    const registrationImportIndex = content.indexOf(
      'import { registerConfiguredConnectors } from "@warlock.js/core";',
    );
    const configImportIndex = content.indexOf('import warlockConfig from "../../warlock.config";');
    const registrationCallIndex = content.indexOf(REGISTRATION_CALL);
    const earlyPhaseIndex = content.indexOf(
      "await connectorsManager.startPhase(ConnectorLifecyclePhase.Early);",
    );

    expect(configLoaderIndex).toBeGreaterThan(-1);
    expect(registrationImportIndex).toBeGreaterThan(configLoaderIndex);
    expect(configImportIndex).toBeGreaterThan(registrationImportIndex);
    expect(registrationCallIndex).toBeGreaterThan(configImportIndex);
    expect(earlyPhaseIndex).toBeGreaterThan(registrationCallIndex);
  });

  it("imports the app's warlock.config from the app root, two levels above the production dir", async () => {
    const content = await generatedEntryContent({
      locales: false,
      events: false,
      main: false,
      routes: false,
    });

    // Same `../../` hop the generated `../../src/app/…` imports use, so the
    // bundler resolves it from `.warlock/production/app.ts` to the config
    // sitting beside `package.json`. A `./warlock.config` here would resolve
    // inside the production dir and fail the build at bundle time.
    expect(content).toContain('import warlockConfig from "../../warlock.config";');
  });

  it("passes the config array explicitly instead of leaving the callee to find one", async () => {
    const content = await generatedEntryContent({
      locales: false,
      events: false,
      main: false,
      routes: false,
    });

    expect(content).toContain(REGISTRATION_CALL);
    // The no-argument form is what silently registered nothing in an artifact.
    expect(content).not.toContain("registerConfiguredConnectors();");
  });

  it("tolerates a config with no connectors key by emitting a `?? []` fallback", async () => {
    const content = await generatedEntryContent({
      locales: false,
      events: false,
      main: false,
      routes: false,
    });

    // A warlock.config that never declares `connectors` makes the property
    // `undefined` at runtime; the emitted fallback is what keeps that a
    // zero-connector boot rather than a TypeError on the first line of the app.
    expect(content).toContain("warlockConfig.connectors ?? []");

    const registrationLine = content
      .split("\n")
      .find((line) => line.startsWith("registerConfiguredConnectors("));

    expect(registrationLine).toBe(REGISTRATION_CALL);
  });

  it("emits the registration exactly once, app files or not", async () => {
    const content = await generatedEntryContent({
      locales: false,
      events: false,
      main: false,
      routes: false,
    });

    const calls = content.split(REGISTRATION_CALL).length - 1;

    expect(calls).toBe(1);
  });
});

/**
 * The build resolves `connectors` ONCE, at build time; the artifact then
 * re-evaluates the same config source at boot. A config that decides its array
 * from the environment can therefore hand the boot a different list than the
 * build drained contributions from. The entry carries the names the build
 * actually resolved, in order, so that difference is caught at startup instead
 * of surfacing as a connector that silently never ran.
 */
describe("ProductionBuilder.generateEntryPoint — expected connector names baked in", () => {
  beforeEach(() => {
    putFileAsync.mockClear();
  });

  it("emits the names this build resolved as a literal expectedNames array", async () => {
    const content = await generatedEntryContent(NO_APP_FILES, [
      buildConnector("database"),
      buildConnector("http"),
    ]);

    expect(content).toContain(
      'registerConfiguredConnectors(warlockConfig.connectors ?? [], { expectedNames: ["database", "http"] });',
    );
  });

  it("keeps the build's order rather than sorting the names", async () => {
    const content = await generatedEntryContent(NO_APP_FILES, [
      buildConnector("http"),
      buildConnector("cache"),
      buildConnector("database"),
    ]);

    // The emitted order is the order this build drained contributions in, and
    // the boot-time check compares it — re-ordering the literal would hide a
    // real drift. It is not start order: connectors start by priority, and
    // array order only breaks ties between equal priorities.
    expect(content).toContain('{ expectedNames: ["http", "cache", "database"] }');
  });

  it("emits an empty expectedNames array when the build resolved no connectors", async () => {
    const content = await generatedEntryContent(NO_APP_FILES);

    expect(content).toContain("{ expectedNames: [] }");
  });

  it("passes the names as the second argument, alongside the config array", async () => {
    const content = await generatedEntryContent(NO_APP_FILES, [buildConnector("database")]);

    const registrationLine = content
      .split("\n")
      .find((line) => line.startsWith("registerConfiguredConnectors("));

    expect(registrationLine).toBe(
      'registerConfiguredConnectors(warlockConfig.connectors ?? [], { expectedNames: ["database"] });',
    );
  });

  it("says in the emitted comment where the list came from and that boot refuses on a mismatch", async () => {
    const content = await generatedEntryContent(NO_APP_FILES, [buildConnector("database")]);

    expect(content).toContain(
      "//     `expectedNames` is the list this build resolved, in order — boot",
    );
    expect(content).toContain(
      "//     refuses to start when the config hands over a different set or order.",
    );
  });
});

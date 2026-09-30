import { fileExistsAsync } from "@warlock.js/fs";
import { Application } from "../application";
import { bootstrap } from "../bootstrap";
import { loadConfigFiles } from "../config/load-config-files";
import { filesOrchestrator } from "../dev-server/files-orchestrator";
import { buildOpenApiForChild } from "../openapi/openapi-child-output";
import {
  OPENAPI_PROTOCOL_VERSION,
  OPENAPI_RESULT_MESSAGE,
  parseOpenApiChildOptions,
  type OpenApiChildRequestOptions,
} from "../openapi/openapi-protocol";
import { collectNamedApiRoutesWithResponses } from "../router/named-api-routes-with-responses";
import { loadEnvironmentFiles } from "../utils/load-environment";
import { appPath } from "../utils/paths";
import type { Environment, RuntimeStrategy } from "../utils/environment";
import { warlockConfigManager } from "../warlock-config/warlock-config.manager";

const PROTOCOL_VERSION = 1;

type RequestMessage = Readonly<{
  version: typeof PROTOCOL_VERSION;
  cwd: string;
  environment?: Environment;
  runtimeStrategy?: RuntimeStrategy;
  /**
   * Present for `warlock generate.openapi`: build the OpenAPI document in this process and
   * send it instead of the route snapshot. The loading above is identical for both.
   */
  openapi?: OpenApiChildRequestOptions;
}>;

process.once("message", async (message: unknown) => {
  try {
    const request = validateRequest(message);
    process.chdir(request.cwd);

    if (request.environment) Application.setEnvironment(request.environment);
    if (request.runtimeStrategy) Application.setRuntimeStrategy(request.runtimeStrategy);

    await loadEnvironmentFiles();
    await warlockConfigManager.load();
    await filesOrchestrator.init();
    await bootstrap();

    if (await fileExistsAsync(appPath("bootstrap.ts"))) {
      await filesOrchestrator.load("src/app/bootstrap.ts");
    }

    await filesOrchestrator.initializeAll();
    filesOrchestrator.specialFilesCollector.collect(filesOrchestrator.getFiles());
    await loadConfigFiles(true);

    for (const file of filesOrchestrator.files.values()) {
      if (file.type === "model") {
        await sendProgress(file.relativePath);
        await filesOrchestrator.moduleLoader.loadModule(file, "model");
      }
    }

    await filesOrchestrator.moduleLoader.loadAll({ onBeforeLoad: (file) => sendProgress(file.relativePath) });

    if (request.openapi) {
      const { document, warnings } = await buildOpenApiForChild({
        cwd: request.cwd,
        files: filesOrchestrator.files.values(),
        request: request.openapi,
        onWarn: (warning) => {
          process.stderr.write(`[warlock] ${warning}\n`);
        },
      });

      await sendAndExit({
        type: OPENAPI_RESULT_MESSAGE,
        result: { version: OPENAPI_PROTOCOL_VERSION, document, warnings },
      });
    }

    const routes = await collectNamedApiRoutesWithResponses({
      appRoot: request.cwd,
      files: filesOrchestrator.files.values(),
      onWarn: (warning) => {
        process.stderr.write(`[warlock] ${warning}\n`);
      },
    });

    await sendAndExit({
      type: "route-registration:snapshot",
      snapshot: { version: PROTOCOL_VERSION, routes },
    });
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    await sendAndExit({ type: "route-registration:error", message }, 1);
  }
});

function validateRequest(value: unknown): RequestMessage {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { version?: unknown }).version !== PROTOCOL_VERSION ||
    typeof (value as { cwd?: unknown }).cwd !== "string" ||
    !isOptionalEnvironment((value as { environment?: unknown }).environment) ||
    !isOptionalRuntimeStrategy((value as { runtimeStrategy?: unknown }).runtimeStrategy)
  ) {
    throw new Error("Route registration child received an invalid protocol request.");
  }

  const openapi = (value as { openapi?: unknown }).openapi;

  if (openapi !== undefined) {
    parseOpenApiChildOptions(openapi);
  }

  return value as RequestMessage;
}

function isOptionalEnvironment(value: unknown): value is Environment | undefined {
  return (
    value === undefined || value === "development" || value === "production" || value === "test"
  );
}

function isOptionalRuntimeStrategy(value: unknown): value is RuntimeStrategy | undefined {
  return value === undefined || value === "development" || value === "production";
}

async function sendAndExit(message: unknown, exitCode = 0): Promise<never> {
  if (typeof process.send !== "function") {
    throw new Error("Route registration child requires an IPC channel.");
  }

  await new Promise<void>((resolve, reject) => {
    process.send!(message, (error) => (error ? reject(error) : resolve()));
  });
  process.disconnect?.();
  process.exit(exitCode);
}

async function sendProgress(module: string): Promise<void> {
  if (typeof process.send !== "function") return;
  await new Promise<void>((resolve, reject) => {
    process.send!({ type: "route-registration:progress", module }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

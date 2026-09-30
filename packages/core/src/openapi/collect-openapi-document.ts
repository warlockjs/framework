import {
  runRegistrationChild,
  type RegistrationChildForker,
} from "../production/registration-child-runner";
import type { Environment, RuntimeStrategy } from "../utils/environment";
import {
  OPENAPI_PROTOCOL_VERSION,
  OPENAPI_RESULT_MESSAGE,
  parseOpenApiChildResult,
  type OpenApiChildRequestOptions,
  type OpenApiChildResult,
} from "./openapi-protocol";

export type CollectOpenApiDocumentOptions = Readonly<{
  cwd?: string;
  environment?: Environment;
  runtimeStrategy?: RuntimeStrategy;
  timeoutMs?: number;
  childEntry?: string;
  forkProcess?: RegistrationChildForker;
  title?: string;
  server?: string;
  includePages?: boolean;
}>;

/**
 * Build the app's OpenAPI document in a fresh process.
 *
 * Uses the same registration child as `warlock build` (it imports the route modules without
 * booting connectors) in OpenAPI mode: the document is built inside the child, where the Seal
 * schemas and resource classes live, and only the finished JSON crosses IPC.
 */
export function collectOpenApiDocument(
  options: CollectOpenApiDocumentOptions = {},
): Promise<OpenApiChildResult> {
  const cwd = options.cwd ?? process.cwd();
  const openapi: OpenApiChildRequestOptions = {
    version: OPENAPI_PROTOCOL_VERSION,
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.server !== undefined ? { server: options.server } : {}),
    ...(options.includePages !== undefined ? { includePages: options.includePages } : {}),
  };

  return runRegistrationChild<OpenApiChildResult>({
    cwd,
    timeoutMs: options.timeoutMs,
    childEntry: options.childEntry,
    forkProcess: options.forkProcess,
    request: {
      version: 1,
      cwd,
      environment: options.environment,
      runtimeStrategy: options.runtimeStrategy,
      openapi,
    },
    resultMessageType: OPENAPI_RESULT_MESSAGE,
    resultNoun: "document",
    readResult: (message) => parseOpenApiChildResult(message.result),
  });
}

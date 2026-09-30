import { collectNamedApiRoutesWithResponses } from "../router/named-api-routes-with-responses";
import type { NamedApiRoute } from "../router/types";
import { devLogWarn } from "./dev-logger";
import { filesOrchestrator } from "./files-orchestrator";

const warned = new Set<string>();

/**
 * Named API routes for the dev server's in-process route-type publisher. Uses the same
 * serializer as the typings child process, so `response` strings never differ between
 * `warlock dev` and `warlock generate.typings`. Each distinct warning is logged once per
 * process, not on every hot reload.
 */
export function collectDevelopmentApiRoutes(): Promise<readonly NamedApiRoute[]> {
  return collectNamedApiRoutesWithResponses({
    appRoot: process.cwd(),
    files: filesOrchestrator.getFiles().values(),
    onWarn: (message) => {
      if (warned.has(message)) return;

      warned.add(message);
      devLogWarn(message);
    },
  });
}

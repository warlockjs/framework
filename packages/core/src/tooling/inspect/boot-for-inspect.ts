import events from "@mongez/events";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolve as resolveModule } from "import-meta-resolve";
import { bootForDiagnostics } from "../../cli/commands/doctor/boot-for-diagnostics";
import type { DoctorBootContext } from "../../cli/commands/doctor/check.types";
import { filesOrchestrator } from "../../dev-server/files-orchestrator";
import { collectResourceExportMap } from "../../router/named-api-routes-with-responses";
import { EventRecorder, type RecordedListener } from "./event-recorder";
import type { InspectOptions } from "./inspect-app";

/** What the boot pass observed, ready to hand to `inspectApp`. */
export type InspectBootResult = {
  context: DoctorBootContext;
  events: RecordedListener[];
  /** Names resource classes by the export of their `*.resource.ts` module. */
  resolveResourceName: (resource: unknown) => string | undefined;
  /** Resource modules that could not be read while naming resources. */
  warnings: string[];
};

/**
 * The app's own `@mongez/events` instance, when it resolves to a different
 * module than core's (two installed copies). `undefined` otherwise.
 */
async function appEventBus(cwd: string): Promise<unknown> {
  try {
    const url = resolveModule("@mongez/events", pathToFileURL(path.join(cwd, "package.json")).href);
    const module: unknown = await import(url);

    return typeof module === "object" && module !== null
      ? Reflect.get(module, "default")
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Boot the app the way `warlock doctor` does — every connector booted, none
 * started, no connection opened and no port bound — while recording the event
 * listeners app modules register.
 */
export async function bootForInspect(cwd = process.cwd()): Promise<InspectBootResult> {
  const recorder = new EventRecorder().start([events, await appEventBus(cwd)]);

  try {
    const context = await bootForDiagnostics();
    const warnings: string[] = [];
    // The same export map `generate.openapi` names resources with.
    const resources = context.booted
      ? await collectResourceExportMap(filesOrchestrator.getFiles().values(), (message) => {
          warnings.push(message);
        })
      : new Map<unknown, { exportName: string }>();

    return {
      context,
      events: recorder.list(),
      resolveResourceName: (resource) => resources.get(resource)?.exportName,
      warnings,
    };
  } finally {
    recorder.stop();
  }
}

/** The `inspectApp` inputs a boot pass provides. */
export function inspectOptionsFromBoot(result: InspectBootResult): InspectOptions {
  return {
    modelModules: result.context.modelModules,
    moduleFailures: result.context.moduleFailures,
    events: result.events,
    resolveResourceName: result.resolveResourceName,
    warnings: result.warnings.map((message) => ({ code: null, message, source: "resources" })),
  };
}

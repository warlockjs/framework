import path from "node:path";
import type { DevtoolsPanel } from "./types";
import { resolveUiRoot } from "./ui-root";

/** Structural contract keeps process supervision an optional application feature. */
export type ProcessPanel = { list(): Promise<readonly unknown[]> };

/** Load app-owned generated registration only when devtools boots in development. */
export async function loadProcessPanel(): Promise<ProcessPanel | undefined> {
  const core = await import("@warlock.js/core");
  if (!("srcPath" in core)) return undefined;
  const { srcPath } = core;
  const { existsSync } = await import("node:fs");
  const { pathToFileURL } = await import("node:url");
  const file = srcPath("app/processes/devtools.ts");
  if (!existsSync(file)) return undefined;
  const module: { processPanel?: ProcessPanel } = await import(pathToFileURL(file).href);
  return module.processPanel;
}

/**
 * The built-in **Processes** tab, registered like any other panel:
 * `GET <path>/api/processes` lists the app's supervised processes (an empty
 * list without a registration) and `ui/panels/processes.js` renders them.
 */
export function processesDevtoolsPanel(processPanel?: ProcessPanel): DevtoolsPanel {
  return {
    id: "processes",
    title: "Processes",
    view: path.join(resolveUiRoot(), "panels", "processes.js"),
    routes: [{ path: "", handler: async () => (processPanel ? await processPanel.list() : []) }],
  };
}

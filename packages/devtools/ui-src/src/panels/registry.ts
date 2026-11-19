import type { ComponentType } from "react";
import type { DevtoolsBuiltInPanelId } from "@contracts";
import type { DevtoolsPanelProps } from "./types";
import { RequestsPanel } from "./requests";
import { QueriesPanel } from "./queries";
import { RoutesPanel } from "./routes";
import { ResourcesPanel } from "./resources";
import { HealthPanel } from "./health";
import { ErrorsPanel } from "./errors";
import { LogsPanel } from "./logs";
import { JobsPanel } from "./jobs";
import { MailPanel } from "./mail";
import { AiPanel } from "./ai";
import { AgentsPanel } from "./agents";
import { ApiPanel } from "./api";
import { AiReportsPanel } from "./ai-reports";
import { AiModelsPanel } from "./ai-models";
import { AiErrorsPanel } from "./ai-errors";
import { AiEvaluatePanel } from "./ai-evaluate";

/**
 * The React component of every built-in tab, by id. Which tabs show, and in
 * what order, comes from `GET api/panels`; ids not listed here are package
 * panels and render through `panel-host/`.
 *
 * Owner: the scaffold (fixed; WP-7 edits only the tab folders).
 */
export const BUILT_IN_PANELS: Record<DevtoolsBuiltInPanelId, ComponentType<DevtoolsPanelProps>> = {
  requests: RequestsPanel,
  queries: QueriesPanel,
  routes: RoutesPanel,
  resources: ResourcesPanel,
  health: HealthPanel,
  errors: ErrorsPanel,
  logs: LogsPanel,
  jobs: JobsPanel,
  mail: MailPanel,
  ai: AiPanel,
  agents: AgentsPanel,
  api: ApiPanel,
  "ai-reports": AiReportsPanel,
  "ai-models": AiModelsPanel,
  "ai-errors": AiErrorsPanel,
  "ai-evaluate": AiEvaluatePanel,
};

/** Whether `id` is a built-in tab. */
export function isBuiltInPanel(id: string): id is DevtoolsBuiltInPanelId {
  return Object.hasOwn(BUILT_IN_PANELS, id);
}

import { useApi, type ApiState } from "@/api/hooks";
import { aiQuery, type AiRouteState } from "./route";

/** How often the AI pages refresh while visible. */
export const AI_REFRESH_MS = 60_000;

/** `useApi` for an AI report route: the range and filters as the query, refreshed every 60 s, previous data kept while a new answer loads. */
export function useAiApi<T>(
  endpoint: "reports" | "models" | "errors",
  state: AiRouteState,
): ApiState<T> & { refreshing: boolean } {
  const api = useApi<T>(`api/ai/${endpoint}?${aiQuery(state)}`, { refreshMs: AI_REFRESH_MS });

  return { ...api, refreshing: api.loading && api.data !== undefined };
}

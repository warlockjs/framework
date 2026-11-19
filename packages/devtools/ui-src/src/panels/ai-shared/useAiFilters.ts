import { useMemo } from "react";
import { aiRoute, parseAiRoute, storeRange, type AiRouteState } from "./route";

/** The filters of an AI page from its hash route, and a setter that writes them back (and remembers the range). */
export function useAiFilters(route: string, navigate: (route: string) => void) {
  const state = useMemo(() => parseAiRoute(route), [route]);

  return {
    state,
    setState: (next: AiRouteState) => {
      storeRange(next.range);
      navigate(aiRoute(next));
    },
  };
}

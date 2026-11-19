import type { DevtoolsAiRangePreset } from "@contracts";

/** The filters of Reports, Models and Errors, kept in the hash after the tab id. */
export type AiRouteState = {
  range: DevtoolsAiRangePreset | "custom";
  /** Epoch ms; only for `custom`. */
  from: number | null;
  to: number | null;
  agent: string;
  /** `provider/model`. */
  model: string;
  provider: string;
};

export const RANGE_STORAGE_KEY = "devtools.ai.range";
export const DEFAULT_RANGE: DevtoolsAiRangePreset = "24h";

const isPreset = (value: string | null | undefined): value is DevtoolsAiRangePreset =>
  value === "24h" || value === "7d" || value === "30d";

/** The last preset the user picked, or the default. Storage may be blocked. */
export function readStoredRange(): DevtoolsAiRangePreset {
  try {
    const value = localStorage.getItem(RANGE_STORAGE_KEY);

    return isPreset(value) ? value : DEFAULT_RANGE;
  } catch {
    return DEFAULT_RANGE;
  }
}

/** Remembers a preset so moving between the AI pages keeps the range. */
export function storeRange(range: AiRouteState["range"]): void {
  if (range === "custom") return;

  try {
    localStorage.setItem(RANGE_STORAGE_KEY, range);
  } catch {
    // Not remembered; the hash still carries the range.
  }
}

/** Reads `range=7d&agent=checkout` (the part of the hash after the tab id). A missing range falls back to the remembered one. */
export function parseAiRoute(route: string): AiRouteState {
  const params = new URLSearchParams(route);
  const range = params.get("range");
  const from = Number(params.get("from"));
  const to = Number(params.get("to"));
  const custom =
    range === "custom" && Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > from;

  return {
    range: isPreset(range) ? range : custom ? "custom" : readStoredRange(),
    from: custom ? from : null,
    to: custom ? to : null,
    agent: params.get("agent") ?? "",
    model: params.get("model") ?? "",
    provider: params.get("provider") ?? "",
  };
}

/** The hash part for a state: `range=7d&agent=checkout`. Empty filters are left out. */
export function aiRoute(state: Partial<AiRouteState> & Pick<AiRouteState, "range">): string {
  const params = new URLSearchParams({ range: state.range });

  if (state.range === "custom" && state.from && state.to) {
    params.set("from", String(state.from));
    params.set("to", String(state.to));
  }

  for (const key of ["agent", "model", "provider"] as const) {
    const value = state[key];

    if (value) params.set(key, value);
  }

  return params.toString();
}

/** The query string of an API call: the filters plus the browser's UTC offset in minutes east. */
export function aiQuery(state: AiRouteState): string {
  const params = new URLSearchParams(aiRoute(state));

  params.set("tz", String(-new Date().getTimezoneOffset()));

  return params.toString();
}

/** Opens another AI tab with the same range (and optionally a filter). */
export function openAiTab(
  id: string,
  state: AiRouteState,
  patch: Partial<AiRouteState> = {},
): void {
  location.hash = `#${id}/${aiRoute({ ...state, agent: "", model: "", provider: "", ...patch })}`;
}

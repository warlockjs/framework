import { useState } from "react";
import type { DevtoolsAiFilterOptions } from "@contracts";
import { Button } from "@/components/ui/button";
import { FilterBar, Segmented } from "@/components/listing";
import { SelectField, TextField } from "@/components/ui/panel-kit";
import { storeRange, type AiRouteState } from "./route";

const HOUR_MS = 3_600_000;

const PRESETS = [
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 d" },
  { value: "30d", label: "30 d" },
  { value: "custom", label: "Custom" },
];

/** Epoch ms as the local `YYYY-MM-DDTHH:mm` an `<input type="datetime-local">` takes. */
export function toLocalInput(at: number): string {
  const date = new Date(at - new Date(at).getTimezoneOffset() * 60_000);

  return date.toISOString().slice(0, 16);
}

function FilterSelect({
  label,
  all,
  value,
  options,
  onChange,
}: {
  label: string;
  all: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  // A filter from the address stays selectable even when the range holds no such value.
  const list = value && !options.includes(value) ? [value, ...options] : options;

  return (
    <SelectField
      aria-label={label}
      value={value}
      className="max-w-48"
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{all}</option>
      {list.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </SelectField>
  );
}

/**
 * The filter row shared by Reports, Models and Errors: range presets and a
 * custom range, then Agent, Model and Provider from what the range holds.
 */
export function AiFilterRow({
  state,
  filters,
  onChange,
}: {
  state: AiRouteState;
  filters: DevtoolsAiFilterOptions | undefined;
  onChange: (next: AiRouteState) => void;
}) {
  const [customOpen, setCustomOpen] = useState(state.range === "custom");
  const [from, setFrom] = useState(state.from ? toLocalInput(state.from) : "");
  const [to, setTo] = useState(state.to ? toLocalInput(state.to) : "");
  const [problem, setProblem] = useState<string | null>(null);
  const [latestInput, setLatestInput] = useState(() => toLocalInput(Date.now()));
  const routeKey = `${state.range}|${state.from}|${state.to}`;
  const [seenRouteKey, setSeenRouteKey] = useState(routeKey);

  // Back/forward in the browser changes `state` from the address: follow it.
  if (seenRouteKey !== routeKey) {
    setSeenRouteKey(routeKey);
    setCustomOpen(state.range === "custom");
    setFrom(state.from ? toLocalInput(state.from) : "");
    setTo(state.to ? toLocalInput(state.to) : "");
  }

  const applyCustom = () => {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      setProblem("Pick both a start and an end time, then apply.");

      return;
    }

    if (end <= start) {
      setProblem("The end must be after the start. Pick a later end time.");

      return;
    }

    // The server keeps totals up to the current hour; a later end is refused.
    if (end > (Math.floor(Date.now() / HOUR_MS) + 1) * HOUR_MS) {
      setProblem("The end is in the future. Pick an end time up to now.");

      return;
    }

    setProblem(null);
    onChange({ ...state, range: "custom", from: start, to: end });
  };

  const set = (patch: Partial<AiRouteState>) => onChange({ ...state, ...patch });

  return (
    <>
      <FilterBar label="AI report filters">
        <Segmented
          label="Date range"
          options={PRESETS}
          value={customOpen ? "custom" : state.range}
          onChange={(value) => {
            if (value === "custom") {
              setLatestInput(toLocalInput(Date.now()));
              setCustomOpen(true);

              return;
            }

            setCustomOpen(false);
            setProblem(null);

            const range = value as AiRouteState["range"];

            storeRange(range);
            set({ range, from: null, to: null });
          }}
        />
        {customOpen ? (
          <>
            <TextField
              type="datetime-local"
              aria-label="Range start"
              max={latestInput}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <TextField
              type="datetime-local"
              aria-label="Range end"
              max={latestInput}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
            <Button type="button" size="sm" onClick={applyCustom}>
              Apply range
            </Button>
          </>
        ) : null}
        <FilterSelect
          label="Agent"
          all="All agents"
          value={state.agent}
          options={filters?.agents ?? []}
          onChange={(agent) => set({ agent })}
        />
        <FilterSelect
          label="Model"
          all="All models"
          value={state.model}
          options={filters?.models ?? []}
          onChange={(model) => set({ model })}
        />
        <FilterSelect
          label="Provider"
          all="All providers"
          value={state.provider}
          options={filters?.providers ?? []}
          onChange={(provider) => set({ provider })}
        />
      </FilterBar>
      {problem ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {problem}
        </p>
      ) : null}
    </>
  );
}

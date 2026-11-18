import type { DevtoolsInstancesView } from "@contracts";
import { ServerIcon } from "lucide-react";
import { useApi } from "@/api/hooks";

export type InstancePickerProps = {
  value: string;
  onChange: (instance: string) => void;
};

/** Picks "All instances" or one process (production only); the choice goes to every tab as `instance`. */
export function InstancePicker({ value, onChange }: InstancePickerProps) {
  const { data, error } = useApi<DevtoolsInstancesView>("api/instances", { refreshMs: 30_000 });

  if (error && !data) {
    return (
      <span className="text-xs text-muted-foreground" title={error.message}>
        Instances unavailable
      </span>
    );
  }

  return (
    <div className="relative">
      <ServerIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <select
        aria-label="Instance"
        className="h-8 max-w-28 rounded-lg max-md:h-10 sm:max-w-48 border border-input bg-card pr-2 pl-8 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="all">All instances</option>
        {data?.instances.map((instance) => (
          <option key={instance.id} value={instance.id}>
            {instance.label}
            {instance.id === data.current ? " (this one)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

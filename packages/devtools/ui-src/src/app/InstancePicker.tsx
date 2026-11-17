import type { DevtoolsInstancesView } from "@contracts";
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
    <select
      aria-label="Instance"
      className="h-8 rounded-md border bg-background px-2 text-sm"
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
  );
}

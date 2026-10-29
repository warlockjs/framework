import { DateTimePicker } from "@mantine/dates";
import { useDateControl } from "../hooks/use-date-control";
import type { DateProps } from "../types/control-props";
import { frameProps } from "./field-frame";

/** The form stores `YYYY-MM-DDTHH:mm`; Mantine speaks `YYYY-MM-DD HH:mm:ss`. */
function toMantine(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
    ? `${value.slice(0, 16).replace("T", " ")}:00`
    : null;
}
function fromMantine(value: string | null): string {
  return value ? value.slice(0, 16).replace(" ", "T") : "";
}

export default function DateTimePickerInput(props: DateProps) {
  const field = useDateControl(props, true);
  const { ref: bindRef } = field.binding;
  return (
    <DateTimePicker
      {...frameProps(props, field.error, field.disabled, field.onBlur)}
      ref={bindRef}
      className={props.className}
      value={toMantine(field.value)}
      onChange={(value) => field.changeValue(fromMantine(value))}
      placeholder={props.placeholder ?? "Choose date"}
      timePickerProps={{ "aria-label": props.timeLabel ?? "Time" }}
      clearable
      clearButtonProps={{ "aria-label": props.clearLabel ?? "Clear" }}
    />
  );
}

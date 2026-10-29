import { TimeInput } from "@mantine/dates";
import { useControl } from "../hooks/use-control";
import type { ControlProps } from "../types/control-props";
import { frameProps } from "./field-frame";

export default function TimePickerInput(props: ControlProps) {
  const field = useControl(props, "time");
  const { ref: bindRef } = field.binding;
  return (
    <TimeInput
      {...frameProps(props, field.error, field.disabled, field.onBlur)}
      ref={bindRef}
      className={props.className}
      value={typeof field.value === "string" ? field.value : ""}
      onChange={(event) => field.changeValue(event.currentTarget.value)}
      placeholder={props.placeholder}
    />
  );
}

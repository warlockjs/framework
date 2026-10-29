import { DatePickerInput as MantineDatePickerInput } from "@mantine/dates";
import { useDateControl } from "../hooks/use-date-control";
import type { DateProps } from "../types/control-props";
import { frameProps } from "./field-frame";

/** Stores `YYYY-MM-DD`, the same string the shadcn kit stores. */
export default function DatePickerInput(props: DateProps) {
  const field = useDateControl(props, false);
  const { ref: bindRef } = field.binding;
  return (
    <MantineDatePickerInput
      {...frameProps(props, field.error, field.disabled, field.onBlur)}
      ref={bindRef}
      className={props.className}
      value={field.value || null}
      onChange={(value) => field.changeValue(value ?? "")}
      placeholder={props.placeholder ?? "Choose date"}
      clearable
      clearButtonProps={{ "aria-label": props.clearLabel ?? "Clear" }}
    />
  );
}

import { Checkbox } from "@mantine/core";
import { useControl } from "../hooks/use-control";
import type { CheckProps } from "../types/control-props";
import { frameProps } from "./field-frame";

export default function CheckboxInput(props: CheckProps) {
  const field = useControl(props, "checkbox");
  const { ref: bindRef } = field.binding;
  return (
    <Checkbox
      {...frameProps(props, field.error, field.disabled, field.onBlur)}
      ref={bindRef}
      className={props.className}
      disabled={field.disabled || props.readOnly}
      checked={Boolean(field.checked)}
      onChange={(event) => field.setChecked(event.currentTarget.checked)}
    />
  );
}

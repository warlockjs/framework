import { Checkbox } from "@mantine/core";
import { useControl } from "../hooks/use-control";
import type { CheckProps } from "../types/control-props";
import { frameProps } from "./field-frame";

export default function CheckboxInput(props: CheckProps) {
  const field = useControl(props, "checkbox");
  return (
    <Checkbox
      {...frameProps(props, field)}
      ref={field.binding.ref}
      className={props.className}
      disabled={field.disabled || props.readOnly}
      checked={Boolean(field.checked)}
      onChange={(event) => field.setChecked(event.currentTarget.checked)}
    />
  );
}

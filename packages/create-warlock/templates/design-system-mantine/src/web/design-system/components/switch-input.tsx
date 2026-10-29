import { Switch } from "@mantine/core";
import { useControl } from "../hooks/use-control";
import type { CheckProps } from "../types/control-props";
import { frameProps } from "./field-frame";

export default function SwitchInput(props: CheckProps) {
  const field = useControl(props, "checkbox");
  return (
    <Switch
      {...frameProps(props, field)}
      ref={field.binding.ref}
      className={props.className}
      disabled={field.disabled || props.readOnly}
      checked={Boolean(field.checked)}
      onChange={(event) => field.setChecked(event.currentTarget.checked)}
    />
  );
}

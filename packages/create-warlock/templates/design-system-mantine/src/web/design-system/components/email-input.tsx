import { TextInput as MantineTextInput } from "@mantine/core";
import { useControl } from "../hooks/use-control";
import type { ControlProps } from "../types/control-props";
import { frameProps } from "./field-frame";

export default function EmailInput(props: ControlProps) {
  const field = useControl(props, "email");
  const { ref: bindRef } = field.binding;
  return (
    <MantineTextInput
      {...frameProps(props, field.error, field.disabled, field.onBlur)}
      ref={bindRef}
      className={props.className}
      type="email"
      value={typeof field.value === "string" ? field.value : ""}
      onChange={(event) => field.changeValue(event.currentTarget.value)}
      placeholder={props.placeholder}
      autoComplete={props.autoComplete}
    />
  );
}

import { TextInput as MantineTextInput } from "@mantine/core";
import { useControl } from "../hooks/use-control";
import type { ControlProps } from "../types/control-props";
import { frameProps } from "./field-frame";

export default function TextInput(props: ControlProps) {
  const field = useControl(props, "text");
  const { ref: bindRef } = field.binding;
  return (
    <MantineTextInput
      {...frameProps(props, field.error, field.disabled, field.onBlur)}
      ref={bindRef}
      className={props.className}
      type="text"
      value={typeof field.value === "string" ? field.value : ""}
      onChange={(event) => field.changeValue(event.currentTarget.value)}
      placeholder={props.placeholder}
      autoComplete={props.autoComplete}
    />
  );
}

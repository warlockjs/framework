import { PasswordInput as MantinePasswordInput } from "@mantine/core";
import { useControl } from "../hooks/use-control";
import type { ControlProps } from "../types/control-props";
import { frameProps } from "./field-frame";

export default function PasswordInput(props: ControlProps) {
  const field = useControl(props, "password");
  const { ref: bindRef } = field.binding;
  return (
    <MantinePasswordInput
      {...frameProps(props, field.error, field.disabled, field.onBlur)}
      ref={bindRef}
      className={props.className}
      value={typeof field.value === "string" ? field.value : ""}
      onChange={(event) => field.changeValue(event.currentTarget.value)}
      placeholder={props.placeholder}
      autoComplete={props.autoComplete}
    />
  );
}

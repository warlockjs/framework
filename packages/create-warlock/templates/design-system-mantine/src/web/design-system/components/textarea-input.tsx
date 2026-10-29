import { Textarea } from "@mantine/core";
import { useControl } from "../hooks/use-control";
import type { ControlProps } from "../types/control-props";
import { frameProps } from "./field-frame";

export default function TextareaInput(props: ControlProps) {
  const field = useControl(props, "textarea");
  const { ref: bindRef } = field.binding;
  return (
    <Textarea
      {...frameProps(props, field.error, field.disabled, field.onBlur)}
      ref={bindRef}
      className={props.className}
      rows={props.rows}
      value={typeof field.value === "string" ? field.value : ""}
      onChange={(event) => field.changeValue(event.currentTarget.value)}
      placeholder={props.placeholder}
      autoComplete={props.autoComplete}
    />
  );
}

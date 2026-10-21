import { Input } from "web/components/ui/input";
import { useControl } from "../hooks/use-control";
import type { ControlProps } from "../types/control-props";
import FieldFrame from "./field-frame";

export default function TimePickerInput(props: ControlProps) {
  const field = useControl(props, "time");
  return (
    <FieldFrame {...props} error={field.error}>
      <Input
        {...field.binding}
        type="time"
        value={typeof field.value === "string" ? field.value : ""}
        onChange={(event) => field.changeValue(event.target.value)}
        placeholder={props.placeholder}
        readOnly={props.readOnly}
        autoComplete={props.autoComplete}
        dir={props.dir}
      />
    </FieldFrame>
  );
}

import { Textarea } from "web/components/ui/textarea";
import { useControl } from "../hooks/use-control";
import type { ControlProps } from "../types/control-props";
import FieldFrame from "./field-frame";

export default function TextareaInput(props: ControlProps) {
  const field = useControl(props, "textarea");
  return (
    <FieldFrame {...props} error={field.error}>
      <Textarea
        {...field.binding}
        rows={props.rows}
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

import { Input } from "web/components/ui/input";
import { useControl } from "../hooks/use-control";
import type { ControlProps } from "../types/control-props";
import FieldFrame from "./field-frame";

export default function PasswordInput(props: ControlProps) {
  const field = useControl(props, "password");
  return (
    <FieldFrame {...props} error={field.error}>
      <Input
        {...field.binding}
        type="password"
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

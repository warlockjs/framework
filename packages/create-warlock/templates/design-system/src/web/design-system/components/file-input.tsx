import { Input } from "web/components/ui/input";
import { useFileControl } from "../hooks/use-file-control";
import type { ControlProps } from "../types/control-props";
import FieldFrame from "./field-frame";

export default function FileInput(props: ControlProps) {
  const field = useFileControl(props);
  return (
    <FieldFrame {...props} error={field.error}>
      <Input
        {...field.binding}
        type="file"
        disabled={field.disabled || props.readOnly}
        accept={props.accept}
        multiple={props.multiple}
        onChange={(event) =>
          field.changeValue(
            props.multiple ? Array.from(event.target.files ?? []) : (event.target.files?.[0] ?? ""),
          )
        }
      />
    </FieldFrame>
  );
}

import { Checkbox } from "web/components/ui/checkbox";
import { useControl } from "../hooks/use-control";
import type { CheckProps } from "../types/control-props";
import FieldFrame from "./field-frame";

export default function CheckboxInput(props: CheckProps) {
  const field = useControl(props, "checkbox");
  return (
    <FieldFrame {...props} error={field.error}>
      <Checkbox
        {...field.binding}
        disabled={field.disabled || props.readOnly}
        checked={Boolean(field.checked)}
        onCheckedChange={(checked) => field.setChecked(checked === true)}
        aria-labelledby={`${props.id}-label`}
      />
    </FieldFrame>
  );
}

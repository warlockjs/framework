import { Button } from "web/components/ui/button";
import { useSubmitControl } from "../hooks/use-submit-control";
import type { ControlProps } from "../types/control-props";
import FieldFrame from "./field-frame";

export default function SubmitButton(props: ControlProps) {
  const field = useSubmitControl(props);
  return (
    <FieldFrame {...props} label={null} error={field.error}>
      <Button
        {...field.binding}
        type="submit"
        disabled={field.disabled}
        aria-busy={field.isSubmitting}
      >
        {props.label}
      </Button>
    </FieldFrame>
  );
}

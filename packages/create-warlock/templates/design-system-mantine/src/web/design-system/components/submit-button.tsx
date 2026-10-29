import { Button } from "@mantine/core";
import { useSubmitControl } from "../hooks/use-submit-control";
import type { ControlProps } from "../types/control-props";
import FieldFrame from "./field-frame";

export default function SubmitButton(props: ControlProps) {
  const field = useSubmitControl(props);
  const { ref: bindRef } = field.binding;
  return (
    <FieldFrame {...props} label={null} error={field.error}>
      <Button
        ref={bindRef}
        id={props.id}
        name={props.name}
        type="submit"
        disabled={field.disabled}
        loading={field.isSubmitting}
        aria-busy={field.isSubmitting}
      >
        {props.label}
      </Button>
    </FieldFrame>
  );
}

import { useSubmitButton } from "@mongez/react-form";
import { useControl } from "./use-control";
import type { ControlProps } from "../types/control-props";

export function useSubmitControl(props: ControlProps) {
  const field = useControl(props, "submit");
  const submit = useSubmitButton();
  return {
    ...field,
    disabled: field.disabled || submit.disabled || submit.isSubmitting,
    isSubmitting: submit.isSubmitting,
  };
}

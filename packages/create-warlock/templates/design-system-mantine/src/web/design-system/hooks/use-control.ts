import { useFormControl } from "@mongez/react-form";
import type { ControlProps } from "../types/control-props";

/** Explicit ids keep SSR, hydration, portal labels and repeated forms aligned. */
export function useControl(props: ControlProps, type = "text", multiple = false) {
  const control = useFormControl(
    { ...props, type, multiple },
    { multiple, isCollectable: type === "submit" ? () => false : undefined },
  );
  const error = props.error ?? control.error;
  const describedBy =
    [props.hint ? `${props.id}-hint` : "", error ? `${props.id}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  const binding = {
    id: props.id,
    name: props.name,
    disabled: control.disabled,
    onBlur: control.onBlur,
    ref: (element: HTMLElement | null) => {
      control.inputRef.current = element;
      control.visibleElementRef.current = element;
    },
    "aria-invalid": Boolean(error),
    "aria-required": props.required || undefined,
    "aria-describedby": describedBy,
  };
  return { ...control, error, binding };
}

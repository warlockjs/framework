import { useEffect } from "react";
import { useControl } from "./use-control";
import type { ControlProps } from "../types/control-props";

export function useFileControl(props: ControlProps) {
  const field = useControl(
    { ...props, value: undefined, defaultValue: props.multiple ? [] : "" },
    "file",
    props.multiple,
  );
  useEffect(() => {
    const clear = () => {
      const input: HTMLInputElement | undefined = field.inputRef.current;
      if (input) {
        input.value = "";
      }
    };
    const reset = field.formControl.onReset(clear);
    const cleared = field.formControl.onClear(clear);
    return () => {
      reset.unsubscribe();
      cleared.unsubscribe();
    };
  }, [field.formControl, field.inputRef]);
  return field;
}

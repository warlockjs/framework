import { FileInput as MantineFileInput } from "@mantine/core";
import { useFileControl } from "../hooks/use-file-control";
import type { ControlProps } from "../types/control-props";
import { frameProps } from "./field-frame";

export default function FileInput(props: ControlProps) {
  const field = useFileControl(props);
  const files = Array.isArray(field.value)
    ? field.value
    : field.value instanceof File
      ? field.value
      : null;
  return (
    <MantineFileInput
      {...frameProps(props, field)}
      ref={field.binding.ref}
      className={props.className}
      disabled={field.disabled || props.readOnly}
      accept={props.accept}
      multiple={props.multiple}
      placeholder={props.placeholder}
      clearable
      value={files as never}
      onChange={(value: File | File[] | null) =>
        field.changeValue(
          props.multiple ? ((value as File[] | null) ?? []) : ((value as File | null) ?? ""),
        )
      }
    />
  );
}

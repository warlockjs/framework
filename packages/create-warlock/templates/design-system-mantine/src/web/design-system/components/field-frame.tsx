import { Input } from "@mantine/core";
import type { ReactNode } from "react";
import type { ControlProps } from "../types/control-props";

type FrameProps = Pick<ControlProps, "id" | "label" | "hint" | "error" | "dir" | "className"> & {
  required?: boolean;
  children: ReactNode;
};

/**
 * The label, hint and error frame around a control that has no Mantine wrapper
 * of its own. Mantine's own inputs take `label`, `description` and `error`
 * directly, so they use `frameProps` instead and skip this wrapper.
 */
export default function FieldFrame({
  id,
  label,
  hint,
  error,
  children,
  dir,
  className,
  required,
}: FrameProps) {
  return (
    <Input.Wrapper
      id={id}
      dir={dir}
      className={className}
      label={label ?? undefined}
      description={hint}
      error={error}
      withAsterisk={required}
    >
      {children}
    </Input.Wrapper>
  );
}

/**
 * The props every Mantine input shares, derived from the contract props and the
 * value returned by `useControl`. Validation errors reach the control through
 * Mantine's `error` prop, so Mantine owns the invalid styling and the
 * `aria-invalid` / `aria-describedby` wiring.
 */
export function frameProps(
  props: Pick<ControlProps, "id" | "name" | "label" | "hint" | "dir" | "required" | "readOnly">,
  field: {
    error?: ReactNode;
    disabled?: boolean;
    binding: { onBlur?: () => unknown; ref: (element: HTMLElement | null) => void };
  },
) {
  return {
    id: props.id,
    name: props.name,
    label: props.label ?? undefined,
    description: props.hint,
    error: field.error,
    withAsterisk: props.required,
    disabled: field.disabled,
    readOnly: props.readOnly,
    dir: props.dir,
    onBlur: field.binding.onBlur,
    "aria-required": props.required || undefined,
  } as const;
}

import type { FormControlProps } from "@mongez/react-form";
import type { ReactNode } from "react";

export type ControlProps = Pick<
  FormControlProps,
  | "name"
  | "rules"
  | "schema"
  | "validate"
  | "validateOn"
  | "onChange"
  | "onError"
  | "errors"
  | "errorKeys"
  | "disabled"
  | "readOnly"
  | "required"
> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  value?: unknown;
  defaultValue?: unknown;
  placeholder?: string;
  className?: string;
  dir?: "ltr" | "rtl";
  autoComplete?: string;
  rows?: number;
  accept?: string;
  multiple?: boolean;
};
export type Choice = { value: string; label: string; disabled?: boolean };
export type SelectProps = ControlProps & {
  options: readonly Choice[];
  searchLabel?: string;
  emptyLabel?: string;
  clearLabel?: string;
};
export type RadioProps = ControlProps & { options: readonly Choice[] };
export type CheckProps = ControlProps & { checked?: boolean; defaultChecked?: boolean };
export type DateProps = ControlProps & {
  clearLabel?: string;
  closeLabel?: string;
  timeLabel?: string;
};

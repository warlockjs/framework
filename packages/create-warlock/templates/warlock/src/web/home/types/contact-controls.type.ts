import type { FormControlProps } from "@mongez/react-form";
import type { ReactNode } from "react";

export type ContactFieldProps = FormControlProps & {
  label: ReactNode;
  multiline?: boolean;
  rows?: number;
};

export type ContactSubmitButtonProps = {
  idleLabel: ReactNode;
  submittingLabel: ReactNode;
};

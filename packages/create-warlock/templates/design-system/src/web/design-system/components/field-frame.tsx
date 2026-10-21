import type { ReactNode } from "react";
import { Label } from "web/components/ui/label";
import type { ControlProps } from "../types/control-props";

export default function FieldFrame({
  id,
  label,
  hint,
  error,
  children,
  dir,
  className,
}: Pick<ControlProps, "id" | "label" | "hint" | "error" | "dir" | "className"> & {
  children: ReactNode;
}) {
  return (
    <div dir={dir} className={className ?? "grid gap-2 text-start"}>
      {label != null ? (
        <Label id={`${id}-label`} htmlFor={id}>
          {label}
        </Label>
      ) : null}
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

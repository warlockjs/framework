import { useFormControl, type FormControlProps } from "@mongez/react-form";

/** Keep control identity, validation and DOM wiring in one hook. */
export function useContactField(props: FormControlProps, rows?: number) {
  const { error, getErrorProps, getInputProps, id } = useFormControl(props);
  const inputProps = getInputProps(rows ? { rows } : undefined);

  return { error, getErrorProps, id, inputProps };
}

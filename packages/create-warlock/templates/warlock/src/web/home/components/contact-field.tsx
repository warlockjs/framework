import { useContactField } from "../hooks/use-contact-field";
import type { ContactFieldProps } from "../types/contact-controls.type";

export default function ContactField({ label, multiline, rows, ...props }: ContactFieldProps) {
  const { error, getErrorProps, inputProps, id } = useContactField(props, rows);

  return (
    <label htmlFor={id}>
      <span>{label}</span>
      {multiline ? <textarea {...inputProps} /> : <input {...inputProps} />}
      {error ? (
        <small className="warlock-field-error" {...getErrorProps()}>
          {error}
        </small>
      ) : null}
    </label>
  );
}

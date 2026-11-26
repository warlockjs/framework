/** Sends the contact form to the server and tracks its sending, success and error state. */
import { type FormSubmitOptions, type InferFormValues } from "@mongez/react-form";
import { useState } from "react";
import type { contactSchema } from "../../../shared/contact.schema";
import { setFormErrors } from "../../shared/utils/set-form-errors";
import { describeContactFailure } from "./describe-contact-failure";

type ContactValues = InferFormValues<typeof contactSchema>;

type ContactResponse = {
  message: string;
};

type ContactErrorBody = {
  error?: { code: string; message: string };
  details?: unknown;
  requestId?: string;
};

type ContactStatus = {
  state: "idle" | "submitting" | "success" | "error";
  message: string;
};

export function useContactForm() {
  const [status, setStatus] = useState<ContactStatus>({ state: "idle", message: "" });

  async function submitContact({
    values,
    form,
  }: FormSubmitOptions<typeof contactSchema>): Promise<void> {
    setStatus({ state: "submitting", message: "Sending to the backend…" });

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values as ContactValues),
      });

      const body = (await response.json().catch(() => ({}))) as ContactErrorBody &
        Partial<ContactResponse>;

      if (!response.ok) {
        if (response.status === 422) {
          setFormErrors({ body: { errors: body.details } }, form);
        }

        setStatus({
          state: "error",
          message: describeContactFailure({
            status: response.status,
            message: body.error?.message,
          }),
        });
        return;
      }

      setStatus({ state: "success", message: body.message ?? "" });
      form.reset();
    } catch {
      setStatus({
        state: "error",
        message: describeContactFailure({}),
      });
    }
  }

  return { status, submitContact };
}

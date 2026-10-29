import { notifications } from "@mantine/notifications";
import type { ReactNode } from "react";

type Message = ReactNode;

function show(color: string, message: Message, title?: ReactNode) {
  return notifications.show({ color, message, title });
}

/** Toast helpers on top of `@mantine/notifications`. Call them from event handlers and callbacks. */
export const notify = {
  success: (message: Message, title?: ReactNode) => show("green", message, title),
  error: (message: Message, title?: ReactNode) => show("red", message, title),
  info: (message: Message, title?: ReactNode) => show("blue", message, title),
  warning: (message: Message, title?: ReactNode) => show("yellow", message, title),
};

/** The first human-readable message in an HTTP result, a page-action payload or an Error. */
export function messageFrom(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? value : undefined;
  }
  const source = value as {
    message?: unknown;
    formErrors?: unknown;
    error?: { body?: unknown; message?: unknown };
    data?: unknown;
  };
  if (Array.isArray(source.formErrors) && typeof source.formErrors[0] === "string") {
    return source.formErrors[0];
  }
  const body = source.error?.body ?? source.data;
  const nested =
    body && typeof body === "object" ? (body as { message?: unknown }).message : undefined;
  for (const candidate of [nested, source.error?.message, source.message]) {
    if (typeof candidate === "string" && candidate !== "") {
      return candidate;
    }
  }
  return undefined;
}

type SubmitMessages = {
  success: Message | ((result: unknown) => Message);
  error?: Message | ((result: unknown) => Message);
};

/**
 * Spread the result into `useSubmitForm` or `useSubmitAction` to show a toast
 * when the submission succeeds or fails:
 *
 * `useSubmitForm({ route: "contact.send", ...notifyOnSubmit({ success: "Sent" }) })`
 *
 * Without an `error` message the server's own message is shown, falling back to
 * a generic line.
 */
export function notifyOnSubmit(messages: SubmitMessages) {
  const resolve = (message: Message | ((result: unknown) => Message), result: unknown) =>
    typeof message === "function" ? (message as (result: unknown) => Message)(result) : message;
  return {
    onSuccess: (result: unknown) => {
      notify.success(resolve(messages.success, result));
    },
    onError: (result: unknown) => {
      notify.error(
        messages.error !== undefined
          ? resolve(messages.error, result)
          : (messageFrom(result) ?? "Something went wrong. Please try again."),
      );
    },
  };
}

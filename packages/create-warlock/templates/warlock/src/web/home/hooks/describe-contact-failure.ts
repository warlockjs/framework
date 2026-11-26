/** Says what went wrong when the contact form cannot be sent, and what to do next. */

/** The failure the form met: no `status` means the request never reached the server. */
export type ContactFailure = {
  status?: number;
  message?: string;
};

/** The words shown in the form's status line for a failed send. */
export function describeContactFailure(failure: ContactFailure): string {
  if (failure.status === undefined) {
    return "Could not reach the server. Check your connection and send the message again.";
  }

  return (
    failure.message ||
    "The server could not send your message. Try again in a moment; what you typed is still here."
  );
}

import type { CapturedMail, MailAddress, MailAttachment } from "@warlock.js/core";
import { currentRequestId } from "../current-request-id";
import type { DevtoolsCollector, DevtoolsDisposer, DevtoolsMailAttachment } from "../types";

function addressToString(address: MailAddress | undefined): string | undefined {
  if (!address) return undefined;

  return typeof address === "string" ? address : `${address.name} <${address.address}>`;
}

function attachmentSize(attachment: MailAttachment): number | undefined {
  if (typeof attachment.content === "string") return Buffer.byteLength(attachment.content);
  if (Buffer.isBuffer(attachment.content)) return attachment.content.length;

  return undefined;
}

function toDevtoolsAttachment(attachment: MailAttachment): DevtoolsMailAttachment {
  return {
    filename: attachment.filename,
    contentType: attachment.contentType,
    size: attachmentSize(attachment),
  };
}

/**
 * Feeds mails captured in development mode, from core's `mailEvents`, into
 * the collector. The captured attachments carry their content, but only
 * metadata is stored — the bytes are never kept.
 */
export async function attachMailSource(collector: DevtoolsCollector): Promise<DevtoolsDisposer> {
  const { mailEvents } = await import("@warlock.js/core");

  const subscription = mailEvents.onCaptured((mail: CapturedMail) => {
    const { normalized } = mail;

    collector.addMail({
      id: mail.id,
      requestId: currentRequestId(),
      capturedAt: mail.timestamp.getTime(),
      from: addressToString(normalized.from),
      to: normalized.to,
      cc: normalized.cc,
      bcc: normalized.bcc,
      subject: normalized.subject,
      html: normalized.html,
      text: normalized.text,
      headers: normalized.headers,
      attachments: normalized.attachments.map(toDevtoolsAttachment),
    });
  });

  return () => subscription.unsubscribe();
}

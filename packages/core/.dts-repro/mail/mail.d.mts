import { MailAddress, MailAttachment, MailConfigurations, MailEvents, MailOptions, MailPriority, MailResult } from "./types.mjs";
import React from "react";

//#region ../../@warlock.js/core/src/mail/mail.d.ts
/**
 * Fluent Mail Builder
 *
 * Provides a chainable API for building and sending emails.
 *
 * @example
 * ```typescript
 * await Mail.to("user@example.com")
 *   .subject("Welcome!")
 *   .component(<WelcomeEmail name="John" />)
 *   .send();
 *
 * // With attachments
 * await Mail.to("user@example.com")
 *   .cc("manager@example.com")
 *   .subject("Invoice")
 *   .component(<InvoiceEmail order={order} />)
 *   .attach(pdfBuffer, "invoice.pdf")
 *   .send();
 *
 * // Multi-tenant
 * await Mail.config(tenant.mailSettings)
 *   .to("user@example.com")
 *   .subject("Hello")
 *   .html("<p>World</p>")
 *   .send();
 * ```
 */
declare class Mail {
  private options;
  /**
   * Private constructor - use static factory methods
   */
  private constructor();
  /**
   * Create a new mail with recipient
   */
  static to(recipient: string | string[]): Mail;
  /**
   * Create a new mail with custom configuration (multi-tenant)
   */
  static config(config: MailConfigurations): Mail;
  /**
   * Create a new mail with named mailer
   */
  static mailer(name: string): Mail;
  /**
   * Set recipient(s)
   */
  to(recipient: string | string[]): this;
  /**
   * Set CC recipient(s)
   */
  cc(recipient: string | string[]): this;
  /**
   * Set BCC recipient(s)
   */
  bcc(recipient: string | string[]): this;
  /**
   * Set reply-to address
   */
  replyTo(address: string): this;
  /**
   * Set from address
   */
  from(address: MailAddress): this;
  /**
   * Set subject
   */
  subject(subject: string): this;
  /**
   * Set HTML content
   */
  html(content: string): this;
  /**
   * Set plain text content
   */
  text(content: string): this;
  /**
   * Set React component as content
   */
  component(element: React.ReactElement): this;
  /**
   * Add attachment
   */
  attach(content: Buffer | string, filename: string, contentType?: string): this;
  /**
   * Add multiple attachments
   */
  attachments(attachments: MailAttachment[]): this;
  /**
   * Attach a file by path
   *
   * The file will be read automatically when the email is sent.
   *
   * @param path Path to the file
   * @param filename Optional custom filename (defaults to basename of path)
   * @param contentType Optional MIME type
   *
   * @example
   * ```typescript
   * Mail.to("user@example.com")
   *   .subject("Invoice")
   *   .html("<p>Please see attached</p>")
   *   .attachFile("./invoices/2024-001.pdf")
   *   .attachFile("./terms.pdf", "terms-and-conditions.pdf")
   *   .send();
   * ```
   */
  attachFile(path: string, filename?: string, contentType?: string): this;
  /**
   * Set priority
   */
  priority(level: MailPriority): this;
  /**
   * Set custom headers
   */
  headers(headers: Record<string, string>): this;
  /**
   * Add a custom header
   */
  header(name: string, value: string): this;
  /**
   * Set tags for categorization
   */
  tags(tags: string[]): this;
  /**
   * Add a tag
   */
  tag(tag: string): this;
  /**
   * Set correlation ID for tracking
   */
  correlationId(id: string): this;
  /**
   * Set configuration (multi-tenant)
   */
  withConfig(config: MailConfigurations): this;
  /**
   * Set named mailer
   */
  withMailer(name: string): this;
  /**
   * Set beforeSending event handler
   */
  beforeSending(handler: MailEvents["beforeSending"]): this;
  /**
   * Set onSent event handler
   */
  onSent(handler: MailEvents["onSent"]): this;
  /**
   * Set onSuccess event handler
   */
  onSuccess(handler: MailEvents["onSuccess"]): this;
  /**
   * Set onError event handler
   */
  onError(handler: MailEvents["onError"]): this;
  /**
   * Get the built options (for debugging)
   */
  getOptions(): Partial<MailOptions>;
  /**
   * Validate the mail before sending
   */
  private validate;
  /**
   * Send the email
   */
  send(): Promise<MailResult>;
}
//#endregion
export { Mail };
//# sourceMappingURL=mail.d.mts.map
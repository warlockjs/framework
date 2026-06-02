//#region ../../@warlock.js/core/src/mail/events.d.ts
/**
 * Generate a unique mail ID for event namespacing
 */
declare function generateMailId(): string;
/**
 * Mail event names (global events)
 */
declare const MAIL_EVENTS: {
  readonly BEFORE_SENDING: "mail.beforeSending";
  readonly SENT: "mail.sent";
  readonly SUCCESS: "mail.success";
  readonly ERROR: "mail.error";
};
/**
 * Get namespaced event name for a specific mail
 * @param mailId Unique mail identifier
 * @param event Event type
 * @returns Namespaced event name (e.g., "mail.abc123.success")
 */
declare function getMailEventName(mailId: string, event: "beforeSending" | "sent" | "success" | "error"): string;
/**
 * Mail events wrapper
 *
 * Supports two event patterns:
 * 1. Global events: `mail.success` - fires for ALL emails
 * 2. Specific events: `mail.$mailId.success` - fires for ONE email
 *
 * ## Usage
 *
 * ```typescript
 * // Global listener - all emails
 * mailEvents.onSuccess((mail, result) => {
 *   console.log("Any mail sent:", result.messageId);
 * });
 *
 * // Specific listener - one email by ID
 * const mailId = generateMailId();
 * mailEvents.onMailSuccess(mailId, (mail, result) => {
 *   console.log("This specific mail sent:", result.messageId);
 * });
 *
 * await sendMail({
 *   id: mailId, // Use the same ID
 *   to: "user@example.com",
 *   subject: "Hello",
 *   html: "<p>World</p>",
 * });
 * ```
 */
declare const mailEvents: {
  /**
   * Trigger a global mail event
   */
  trigger: (eventName: keyof typeof MAIL_EVENTS, ...args: any[]) => any;
  /**
   * Trigger a specific mail event (by mail ID)
   */
  triggerForMail: (mailId: string, event: "beforeSending" | "sent" | "success" | "error", ...args: any[]) => any;
  /**
   * Subscribe to global mail events
   */
  on: (eventName: keyof typeof MAIL_EVENTS, callback: (...args: any[]) => void) => import("@mongez/events").EventSubscription;
  /**
   * Subscribe to beforeSending event (all mails)
   */
  onBeforeSending: (callback: (mail: any) => void | Promise<void> | false | Promise<false>) => import("@mongez/events").EventSubscription;
  /**
   * Subscribe to sent event (all mails, after attempt)
   */
  onSent: (callback: (mail: any, result: any, error: any) => void | Promise<void>) => import("@mongez/events").EventSubscription;
  /**
   * Subscribe to success event (all mails)
   */
  onSuccess: (callback: (mail: any, result: any) => void | Promise<void>) => import("@mongez/events").EventSubscription;
  /**
   * Subscribe to error event (all mails)
   */
  onError: (callback: (mail: any, error: any) => void | Promise<void>) => import("@mongez/events").EventSubscription;
  /**
   * Subscribe to beforeSending event for a specific mail
   */
  onMailBeforeSending: (mailId: string, callback: (mail: any) => void | Promise<void> | false | Promise<false>) => import("@mongez/events").EventSubscription;
  /**
   * Subscribe to sent event for a specific mail
   */
  onMailSent: (mailId: string, callback: (mail: any, result: any, error: any) => void | Promise<void>) => import("@mongez/events").EventSubscription;
  /**
   * Subscribe to success event for a specific mail
   */
  onMailSuccess: (mailId: string, callback: (mail: any, result: any) => void | Promise<void>) => import("@mongez/events").EventSubscription;
  /**
   * Subscribe to error event for a specific mail
   */
  onMailError: (mailId: string, callback: (mail: any, error: any) => void | Promise<void>) => import("@mongez/events").EventSubscription;
};
//#endregion
export { MAIL_EVENTS, generateMailId, getMailEventName, mailEvents };
//# sourceMappingURL=events.d.mts.map
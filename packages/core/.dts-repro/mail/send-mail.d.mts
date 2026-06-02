import { MailOptions, MailResult } from "./types.mjs";

//#region ../../@warlock.js/core/src/mail/send-mail.d.ts
/**
 * Send an email
 *
 * @param options Mail options including recipients, content, and configuration
 * @returns Result containing success status, message ID, and accepted/rejected recipients
 *
 * @example
 * ```typescript
 * // Basic usage
 * await sendMail({
 *   to: "user@example.com",
 *   subject: "Hello",
 *   html: "<p>World</p>",
 * });
 *
 * // With React component
 * await sendMail({
 *   to: "user@example.com",
 *   subject: "Welcome!",
 *   component: <WelcomeEmail name="John" />,
 * });
 *
 * // Track specific mail with events
 * const mailId = generateMailId();
 * mailEvents.onMailSuccess(mailId, (mail, result) => {
 *   console.log("This specific mail was sent!");
 * });
 * await sendMail({ id: mailId, to: "...", subject: "...", html: "..." });
 * ```
 */
declare function sendMail(options: MailOptions): Promise<MailResult>;
//#endregion
export { sendMail };
//# sourceMappingURL=send-mail.d.mts.map